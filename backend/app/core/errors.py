class ApiError(Exception):
    """An expected failure. `message` is shown to clients, so it must reveal nothing internal."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        clear_auth_cookies: bool = False,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.clear_auth_cookies = clear_auth_cookies
        self.retry_after = retry_after
