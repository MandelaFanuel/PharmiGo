from rest_framework.authentication import TokenAuthentication, get_authorization_header


class PharmigoTokenAuthentication(TokenAuthentication):
    """
    Accept DRF Token auth and Bearer auth to support the frontend session token.
    """

    keyword = "Token"

    def authenticate(self, request):
        auth = get_authorization_header(request).split()
        if not auth:
            return None

        scheme = auth[0].decode("utf-8").lower()
        if scheme not in {"token", "bearer"}:
            return None

        if len(auth) == 1:
            msg = "Invalid token header. No credentials provided."
            raise self.get_authenticate_header_error(msg)
        if len(auth) > 2:
            msg = "Invalid token header. Token string should not contain spaces."
            raise self.get_authenticate_header_error(msg)

        try:
            token = auth[1].decode("utf-8")
        except UnicodeError as exc:
            msg = "Invalid token header. Token string should not contain invalid characters."
            raise self.get_authenticate_header_error(msg) from exc

        return self.authenticate_credentials(token)

    def get_authenticate_header_error(self, message):
        from rest_framework import exceptions

        raise exceptions.AuthenticationFailed(message)
