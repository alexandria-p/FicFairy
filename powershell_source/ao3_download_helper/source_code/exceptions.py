"""Custom exceptions go here."""


class Ao3DownloaderException(Exception):
    pass


class TimeoutException(Ao3DownloaderException):
    pass


class LockedException(Ao3DownloaderException):
    pass


class DeletedException(Ao3DownloaderException):
    pass


class HiddenException(Ao3DownloaderException):
    pass


class ProceedException(Ao3DownloaderException):
    pass


class DownloadException(Ao3DownloaderException):
    pass


class LoginException(Ao3DownloaderException):
    pass


class InvalidLinkException(Ao3DownloaderException):
    pass


class InvalidStatusCodeException(Ao3DownloaderException):
    pass


class CloudflareException(Ao3DownloaderException):
    pass


class PdfParsingException(Ao3DownloaderException):
    pass


class SeriesLinkException(Ao3DownloaderException):
    pass


class StepSkippedException(Ao3DownloaderException):
    """Raised inside a listing walk when the debug panel's Skip this step was pressed: the walk
    ends where it is, keeping everything already written, and the step is marked skipped. Not a
    stop - the run goes on to its next step - so it is never a CancelledException."""
    pass


class CancelledException(Ao3DownloaderException):
    """Raised when a caller asks for a run to stop. Unwinds to the nearest handler,
    which keeps whatever was already written rather than discarding it."""
    pass


class SessionExpiredException(Ao3DownloaderException):
    """Raised when ao3 has stopped recognising the login this run started with.

    Ends the run rather than being recorded per work. Once the session is gone every
    restricted work fails for the same reason, and grinding through hundreds of them
    produces a failure list that says nothing and spends the rate limit saying it."""
    pass


class SavedFileException(Ao3DownloaderException):
    """Raised when a downloaded file is not on disk as it should be, and has been removed.

    A failure of that work, recorded like any other - but a problem with the folder, not
    with ao3, so it is no reason to spend a request asking whether the login still holds."""
    pass


class Ao3DownException(Ao3DownloaderException):
    """Raised when ao3 answers with its maintenance page, and goes on doing so.

    Every request to ao3 fails the same way until it is back, so once one has given up the
    rest of the run does not ask again (`Repository.ao3_down`) - each of them failing after
    the same minutes of retries would hold a run up for hours saying nothing new."""
    pass


class PausedException(Ao3DownloaderException):
    """Raised when a pause arrives while a response body is still coming down.

    Control flow, not an error. It never leaves `Repository.my_request`: the part-read body
    is thrown away, the run waits, and then the *same* request is made again from the start.
    Nothing has reached disk at that point, so there is nothing to undo."""
    pass


class FicHubException(Ao3DownloaderException):
    """Raised when FicHub cannot give us a work ao3 would not: not there, not in that format,
    or an answer that is not the one its api gives.

    `reply` is what FicHub actually sent, for an answer that was not its usual reply
    (`fichub.odd_reply`): kept with the run so it can be looked at afterwards."""

    def __init__(self, *args, reply: dict | None = None):
        super().__init__(*args)
        self.reply = reply
