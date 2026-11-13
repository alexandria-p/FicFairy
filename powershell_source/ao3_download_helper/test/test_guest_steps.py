"""Guest mode's pretend runs list the helper's own steps, in the helper's own words."""

import os
import re
import sys

from source_code import strings

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, '..', '..', '..', 'gui_source', 'src', 'app')
sys.path.insert(0, os.path.join(HERE, '..', 'dev'))

import guest_plan_cases  # noqa: E402


# region guest mode's checklists

def test_the_table_of_checklists_guest_mode_is_held_to_is_the_helpers_own():
    # rewrite it with dev/guest_plan_cases.py when step_plan changes - guest-runs.spec.ts then
    # says whether guest mode's port (guestPlan) still lists the same
    with open(os.path.join(APP, 'guest-plan-cases.ts'), encoding='utf-8') as file:
        assert file.read() == guest_plan_cases.text()


def test_every_step_label_guest_mode_shows_is_the_helpers():
    with open(os.path.join(APP, 'guest-runs.ts'), encoding='utf-8') as file:
        source = file.read()
    block = source[source.index('GUEST_STEP_LABELS = {'):source.index('} as const;')]
    labels = dict(re.findall(r"(STEP_[A-Z_]+): '([^']*)'", block))
    helper = {name: getattr(strings, name) for name in dir(strings) if name.startswith('STEP_')}
    assert labels == helper

# endregion
