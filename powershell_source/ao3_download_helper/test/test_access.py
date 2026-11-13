"""A hosted helper: the passcode on every request, and the login that arrives sealed."""

import base64
import json
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import MagicMock, patch

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from source_code import access, server, strings
from source_code.fileio import FileOps


PASSCODE = 'a long passcode'
PAGE = 'https://someone.github.io'


@pytest.fixture(scope='module')
def key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def pem(key) -> str:
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption()).decode('ascii')


def seal(key, username='Someone', password='a-password', sent=None, nonce='n-1') -> str:
    """A login sealed the way the page seals one."""

    login = {'username': username, 'password': password,
             'sent': time.time() * 1000 if sent is None else sent, 'nonce': nonce}
    blob = key.public_key().encrypt(json.dumps(login).encode('utf-8'), padding.OAEP(
        mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    return base64.b64encode(blob).decode('ascii')


@pytest.fixture
def settings(tmp_path, monkeypatch):
    """Write a settings.ini the helper will read, from a dict of its values."""

    monkeypatch.setenv(strings.ENV_CONFIG_FOLDER, str(tmp_path))

    def write(**values):
        lines = ['[settings]'] + [f'{k}={v}' for k, v in values.items()]
        (tmp_path / strings.INI_FILE_NAME).write_text('\n'.join(lines), encoding='utf-8')

    write()
    return write


@pytest.fixture(autouse=True)
def no_secrets(monkeypatch):
    # whatever the machine running the tests has set must not leak into them
    monkeypatch.delenv(access.ENV_PASSCODE, raising=False)
    monkeypatch.delenv(access.ENV_PRIVATE_KEY, raising=False)
    access._KEYS.clear()


# region the passcode

@pytest.mark.parametrize('header', [None, '', PASSCODE, 'Bearer ', 'Bearer wrong',
                                    'Bearer a long passcod', 'Basic ' + PASSCODE])
def test_anything_but_the_passcode_as_a_bearer_token_is_refused(header):
    assert access.passcode_matches(header, PASSCODE) is False


def test_the_passcode_as_a_bearer_token_is_accepted():
    assert access.passcode_matches('Bearer ' + PASSCODE, PASSCODE) is True


def test_a_helper_with_no_passcode_set_accepts_nobody_not_everybody():
    # an empty guess must never match an empty passcode
    assert access.passcode_matches('Bearer ', '') is False

# endregion


# region the sealed login

def test_a_sealed_login_opens_to_the_username_and_password(key):
    assert access.open_login(seal(key, nonce='open-1'), key, seen=access.Seen()) == \
        ('Someone', 'a-password')


def test_a_login_sealed_for_another_key_is_refused(key):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(access.AccessError, match='different keys'):
        access.open_login(seal(other), key, seen=access.Seen())


@pytest.mark.parametrize('sealed', ['', 'not base64 at all!', base64.b64encode(b'x').decode()])
def test_a_login_that_is_not_one_is_refused(key, sealed):
    with pytest.raises(access.AccessError):
        access.open_login(sealed, key, seen=access.Seen())


def test_a_login_sent_again_is_refused(key):
    # one copied out of a log must not be good for a second run
    seen = access.Seen()
    sealed = seal(key, nonce='twice')
    access.open_login(sealed, key, seen=seen)
    with pytest.raises(access.AccessError, match='already been used'):
        access.open_login(sealed, key, seen=seen)


@pytest.mark.parametrize('age', [access.LOGIN_MAX_AGE_SECONDS + 5, -access.LOGIN_MAX_AGE_SECONDS - 5])
def test_a_login_too_far_from_now_is_refused(key, age):
    now = time.time()
    with pytest.raises(access.AccessError, match='too old'):
        access.open_login(seal(key, sent=(now - age) * 1000), key, now=now, seen=access.Seen())


def test_the_reason_a_login_is_refused_never_repeats_the_password(key):
    try:
        access.open_login(seal(key, password='hunter2', sent=0), key, seen=access.Seen())
    except access.AccessError as e:
        assert 'hunter2' not in str(e)


def test_with_no_key_configured_the_login_arrives_as_it_always_has():
    assert access.login_from({'username': ' Someone ', 'password': 'pw'}) == ('Someone', 'pw')


def test_with_a_key_configured_a_plain_login_is_refused(key, monkeypatch):
    # a page built without the public key would otherwise send the password in the clear
    monkeypatch.setenv(access.ENV_PRIVATE_KEY, pem(key))
    with pytest.raises(access.AccessError, match='encrypted'):
        access.login_from({'username': 'Someone', 'password': 'pw'})


def test_with_a_key_configured_a_sealed_login_is_opened(key, monkeypatch):
    monkeypatch.setenv(access.ENV_PRIVATE_KEY, pem(key))
    assert access.login_from({'credentials': seal(key, nonce='from-body')}) == \
        ('Someone', 'a-password')


def test_a_key_pasted_with_escaped_newlines_still_loads(key, monkeypatch):
    # a multi-line secret squeezed into a one-line field
    monkeypatch.setenv(access.ENV_PRIVATE_KEY, pem(key).replace('\n', '\\n'))
    assert access.private_key() is not None


def test_a_small_key_is_refused():
    small = rsa.generate_private_key(public_exponent=65537, key_size=1024)
    with pytest.raises(ValueError, match='2048'):
        access.load_private_key(pem(small))


def test_a_start_request_with_a_bad_sealed_login_is_a_straight_400(key, monkeypatch):
    monkeypatch.setenv(access.ENV_PRIVATE_KEY, pem(key))
    sent = {}
    handler = MagicMock()
    handler.path = '/api/jobs'
    handler.read_json.return_value = {'action': server.ACTION_SYNC, 'credentials': 'garbage!'}
    handler.send_json.side_effect = lambda status, body: sent.update(status=status, body=body)

    with patch.object(server.threading, 'Thread') as thread:
        server.Handler.do_POST(handler)

    assert sent['status'] == 400
    thread.assert_not_called()


def test_a_start_request_with_a_sealed_login_runs_with_what_it_opens_to(key, monkeypatch):
    monkeypatch.setenv(access.ENV_PRIVATE_KEY, pem(key))
    sent = {}
    handler = MagicMock()
    handler.path = '/api/jobs'
    handler.read_json.return_value = {'action': server.ACTION_SYNC, 'filetypes': ['JSON'],
                                      'credentials': seal(key, nonce='starts')}
    handler.send_json.side_effect = lambda status, body: sent.update(status=status, body=body)

    with patch.object(server.threading, 'Thread') as thread:
        server.Handler.do_POST(handler)

    assert sent['status'] == 202, sent
    job, password = thread.call_args.kwargs['args']
    assert job.username == 'Someone'
    assert password == 'a-password'

# endregion


# region the gate, on a live helper

@pytest.fixture
def live():
    httpd = ThreadingHTTPServer((server.HOST, 0), server.Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://{server.HOST}:{httpd.server_address[1]}'
    finally:
        httpd.shutdown()
        httpd.server_close()


def ask(base, path, method='GET', headers=None):
    request = urllib.request.Request(base + path, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def test_without_the_setting_nothing_asks_for_a_passcode(live, settings):
    status, _, _ = ask(live, '/api/auth')
    assert status == 200


def test_the_page_without_the_passcode_is_told_401_so_it_can_ask(live, settings, monkeypatch):
    settings(RequirePasscode='true', PageOrigin=PAGE)
    monkeypatch.setenv(access.ENV_PASSCODE, PASSCODE)

    status, headers, body = ask(live, '/api/config', headers={'Origin': PAGE})

    assert status == 401
    assert json.loads(body)['passcode'] is True
    # and the browser lets the page read that answer, or it could not tell it apart
    assert headers.get('Access-Control-Allow-Origin') == PAGE


def test_anyone_else_without_the_passcode_is_told_there_is_nothing_here(live, settings, monkeypatch):
    settings(RequirePasscode='true', PageOrigin=PAGE)
    monkeypatch.setenv(access.ENV_PASSCODE, PASSCODE)

    refused = ask(live, '/api/config', headers={'Origin': 'https://elsewhere.example'})
    missing = ask(live, '/no/such/path', headers={'Authorization': 'Bearer ' + PASSCODE})

    # exactly what a path that does not exist answers
    assert refused[0] == 404
    assert refused[2] == missing[2]


def test_a_post_is_gated_as_well_as_a_get(live, settings, monkeypatch):
    settings(RequirePasscode='true', PageOrigin=PAGE)
    monkeypatch.setenv(access.ENV_PASSCODE, PASSCODE)

    status, _, _ = ask(live, '/api/jobs', method='POST', headers={'Origin': PAGE})

    assert status == 401


def test_with_the_passcode_the_helper_answers_as_usual(live, settings, monkeypatch):
    settings(RequirePasscode='true', PageOrigin=PAGE)
    monkeypatch.setenv(access.ENV_PASSCODE, PASSCODE)

    status, _, body = ask(live, '/api/jobs',
                          headers={'Origin': PAGE, 'Authorization': 'Bearer ' + PASSCODE})

    assert status == 200
    assert 'active' in json.loads(body)


def test_a_preflight_is_answered_without_the_passcode(live, settings, monkeypatch):
    # a browser sends no Authorization header on a preflight, so gating it would block
    # every request that carries one
    settings(RequirePasscode='true', PageOrigin=PAGE)
    monkeypatch.setenv(access.ENV_PASSCODE, PASSCODE)

    status, headers, _ = ask(live, '/api/jobs', method='OPTIONS', headers={
        'Origin': PAGE, 'Access-Control-Request-Headers': 'authorization'})

    assert status == 204
    assert 'Authorization' in headers.get('Access-Control-Allow-Headers', '')
    assert headers.get('Access-Control-Allow-Origin') == PAGE


# every path the helper answers, and some it does not: none says more than 401 or 404 without
# the passcode, by either method, from the page or from anywhere else
EVERY_PATH = [
    '/api/auth', '/api/config', '/api/settings-file', '/api/jobs', '/api/jobs/x/events',
    '/api/jobs/x/record', '/api/jobs/x/blobs/y', '/api/runs', '/api/runs/floors',
    '/api/runs/retryable', '/api/update', '/api/file-names', '/api/jobs/x/answer',
    '/api/jobs/x/cancel', '/api/jobs/x/force-stop', '/api/jobs/x/pause', '/api/jobs/x/resume',
    '/api/jobs/x/skip', '/', '/no/such/path',
]


@pytest.mark.parametrize('method', ['GET', 'POST'])
def test_no_path_answers_anything_without_the_passcode(live, settings, monkeypatch, method):
    settings(RequirePasscode='true', PageOrigin=PAGE)
    monkeypatch.setenv(access.ENV_PASSCODE, PASSCODE)

    for path in EVERY_PATH:
        page = ask(live, path, method=method, headers={'Origin': PAGE})
        stranger = ask(live, path, method=method)
        assert page[0] == 401, (method, path, page[0])
        assert stranger[0] == 404, (method, path, stranger[0])


@pytest.mark.parametrize('method', ['PUT', 'DELETE', 'PATCH'])
def test_any_other_method_is_gated_too_and_never_shows_pythons_own_error_page(live, settings, monkeypatch, method):
    settings(RequirePasscode='true', PageOrigin=PAGE)
    monkeypatch.setenv(access.ENV_PASSCODE, PASSCODE)

    stranger = ask(live, '/api/config', method=method)
    owner = ask(live, '/api/config', method=method, headers={'Authorization': 'Bearer ' + PASSCODE})

    assert stranger[0] == 404
    assert stranger[2] == ask(live, '/no/such/path', headers={'Authorization': 'Bearer ' + PASSCODE})[2]
    assert owner[0] == 405
    assert b'<html' not in owner[2].lower()


def test_a_preflight_from_anywhere_but_the_page_is_told_there_is_nothing_here(live, settings, monkeypatch):
    settings(RequirePasscode='true', PageOrigin=PAGE)
    monkeypatch.setenv(access.ENV_PASSCODE, PASSCODE)

    assert ask(live, '/api/jobs', method='OPTIONS')[0] == 404
    assert ask(live, '/api/jobs', method='OPTIONS', headers={'Origin': 'https://elsewhere.example'})[0] == 404


def test_no_answer_names_the_app_or_its_python(live, settings, monkeypatch):
    settings(RequirePasscode='true', PageOrigin=PAGE)
    monkeypatch.setenv(access.ENV_PASSCODE, PASSCODE)

    _, headers, _ = ask(live, '/api/config')

    assert 'ao3' not in headers.get('Server', '').lower()
    assert 'python' not in headers.get('Server', '').lower()


@pytest.mark.parametrize('origin', ['https://someone.github.io.example.com',
                                    'http://someone.github.io', 'https://other.github.io'])
def test_only_the_named_page_is_let_in_by_cors(origin):
    assert server.page_may_call(origin, PAGE) is False


def test_the_page_on_this_computer_is_always_let_in():
    assert server.page_may_call('http://localhost:4200', '') is True
    assert server.page_may_call('http://127.0.0.1:4400', PAGE) is True


def test_a_trailing_slash_on_the_setting_does_not_shut_the_page_out(settings):
    settings(PageOrigin=PAGE + '/')
    assert access.page_origin(FileOps()) == PAGE

# endregion


# region refusing to start unsafely

def test_a_passcode_required_and_not_given_stops_the_start(settings):
    settings(RequirePasscode='true')
    assert access.ENV_PASSCODE in server.startup_problem('127.0.0.1', FileOps())


def test_listening_beyond_this_computer_without_a_passcode_is_refused(settings):
    assert strings.INI_REQUIRE_PASSCODE in server.startup_problem('0.0.0.0', FileOps())


def test_listening_beyond_this_computer_without_a_key_is_refused(settings, monkeypatch):
    settings(RequirePasscode='true')
    monkeypatch.setenv(access.ENV_PASSCODE, PASSCODE)
    assert access.ENV_PRIVATE_KEY in server.startup_problem('0.0.0.0', FileOps())


def test_a_key_that_will_not_load_stops_the_start(settings, monkeypatch):
    monkeypatch.setenv(access.ENV_PRIVATE_KEY, 'not a key')
    assert 'PEM' in server.startup_problem('127.0.0.1', FileOps())


def test_a_fully_set_up_hosted_helper_may_start(settings, monkeypatch, key):
    settings(RequirePasscode='true', PageOrigin=PAGE)
    monkeypatch.setenv(access.ENV_PASSCODE, PASSCODE)
    monkeypatch.setenv(access.ENV_PRIVATE_KEY, pem(key))
    assert server.startup_problem('0.0.0.0', FileOps()) == ''


def test_the_usual_helper_on_this_computer_may_start(settings):
    assert server.startup_problem('127.0.0.1', FileOps()) == ''


def test_serve_refuses_an_unsafe_setup_before_binding_anything(settings, capsys):
    with patch.object(server, 'ThreadingHTTPServer') as bind, pytest.raises(SystemExit):
        server.serve(port=4400, host='0.0.0.0')
    bind.assert_not_called()
    assert 'could not start' in capsys.readouterr().out


def test_serve_takes_its_address_from_the_environment(settings, monkeypatch, key):
    settings(RequirePasscode='true', PageOrigin=PAGE)
    monkeypatch.setenv(access.ENV_PASSCODE, PASSCODE)
    monkeypatch.setenv(access.ENV_PRIVATE_KEY, pem(key))
    monkeypatch.setenv(server.ENV_HOST, '0.0.0.0')
    monkeypatch.setenv(server.ENV_PORT, '10000')

    httpd = MagicMock()
    with patch.object(server, 'already_listening', return_value=False) as probe, \
         patch.object(server, 'ThreadingHTTPServer', return_value=httpd) as bind:
        server.serve()

    bind.assert_called_once_with(('0.0.0.0', 10000), server.Handler)
    # asking 0.0.0.0 whether something is there means asking this computer
    probe.assert_called_once_with(server.HOST, 10000)

# endregion


# region wrong passcodes

def test_the_third_wrong_passcode_blocks_the_address_for_an_hour_whatever_it_sends_next():
    guard = access.PasscodeGuard()
    assert guard.wrong('1.2.3.4', now=0) is False
    assert guard.wrong('1.2.3.4', now=10) is False
    assert guard.blocked_for('1.2.3.4', now=10) == 0
    assert guard.wrong('1.2.3.4', now=20) is True
    assert guard.blocked_for('1.2.3.4', now=20) == access.BLOCK_SECONDS
    # another address is not touched, and the block ends when its hour does
    assert guard.blocked_for('5.6.7.8', now=20) == 0
    assert guard.blocked_for('1.2.3.4', now=20 + access.BLOCK_SECONDS) == 0


def test_wrong_passcodes_an_hour_apart_never_add_up_and_the_right_one_clears_the_count():
    guard = access.PasscodeGuard()
    guard.wrong('a', now=0)
    guard.wrong('a', now=10)
    assert guard.wrong('a', now=10 + access.BLOCK_SECONDS) is False
    guard.right('a')
    guard.wrong('a', now=20 + access.BLOCK_SECONDS)
    assert guard.wrong('a', now=30 + access.BLOCK_SECONDS) is False


def test_a_hosted_helper_reads_the_address_its_proxy_wrote_never_one_a_visitor_wrote():
    def headers(**given):
        return {key.replace('_', '-'): value for key, value in given.items()}
    # on this computer no header is believed
    assert access.client_address(headers(X_Forwarded_For='9.9.9.9'), '127.0.0.1', False) == ('127.0.0.1', 'socket')
    # the last entry is the one the nearest proxy added; a visitor can only write those before it
    assert access.client_address(headers(X_Forwarded_For='6.6.6.6, 1.2.3.4'), '10.0.0.1', True) == (
        '1.2.3.4', 'X-Forwarded-For (last)')
    assert access.client_address(headers(CF_Connecting_IP='1.2.3.4', X_Forwarded_For='6.6.6.6'), '10.0.0.1', True)[0] == '1.2.3.4'
    assert access.client_address({}, '10.0.0.1', True) == ('10.0.0.1', 'socket')


def test_the_helper_refuses_an_address_after_three_wrong_passcodes_the_right_one_included(live, settings, monkeypatch):
    settings(RequirePasscode='true', PageOrigin=PAGE)
    monkeypatch.setenv(access.ENV_PASSCODE, PASSCODE)
    said = []
    monkeypatch.setattr(server, 'to_console', said.append)
    page = {'Origin': PAGE}

    # asking with no passcode at all is not a guess
    for _ in range(5):
        assert ask(live, '/api/config', headers=page)[0] == 401
    assert ask(live, '/api/auth', headers={**page, 'Authorization': 'Bearer one'})[0] == 401
    assert ask(live, '/api/auth', headers={**page, 'Authorization': 'Bearer two'})[0] == 401
    status, headers, body = ask(live, '/api/auth', headers={**page, 'Authorization': 'Bearer three'})
    assert status == 429
    assert json.loads(body)['retryAfterMinutes'] == 60
    assert headers['Retry-After'] == str(access.BLOCK_SECONDS)
    assert ask(live, '/api/auth', headers={**page, 'Authorization': f'Bearer {PASSCODE}'})[0] == 429
    # anything not the page learns nothing, blocked or not
    assert ask(live, '/api/auth', headers={'Authorization': f'Bearer {PASSCODE}'})[0] == 404
    assert any('blocked for 60 minutes' in line and 'socket' in line for line in said)
    # and no passcode is ever written to the console
    assert not any(PASSCODE in line or 'three' in line for line in said)


def test_one_address_blocked_leaves_another_free(live, settings, monkeypatch):
    settings(RequirePasscode='true', PageOrigin=PAGE)
    monkeypatch.setenv(access.ENV_PASSCODE, PASSCODE)
    monkeypatch.setattr(server, 'to_console', lambda line: None)
    monkeypatch.setattr(server.Handler, 'host', '0.0.0.0')
    stranger = {'Origin': PAGE, 'X-Forwarded-For': '6.6.6.6'}
    owner = {'Origin': PAGE, 'X-Forwarded-For': '1.2.3.4', 'Authorization': f'Bearer {PASSCODE}'}

    for guess in ('a', 'b', 'c'):
        ask(live, '/api/auth', headers={**stranger, 'Authorization': f'Bearer {guess}'})

    assert ask(live, '/api/auth', headers={**stranger, 'Authorization': f'Bearer {PASSCODE}'})[0] == 429
    assert ask(live, '/api/auth', headers=owner)[0] == 200

# endregion
