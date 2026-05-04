import os
import sys


REQUIRED_ENV = ("SECRET_KEY",)


def validate_environment():
    missing = [name for name in REQUIRED_ENV if not os.getenv(name)]
    if missing:
        print(
            "Missing required environment variables: "
            + ", ".join(missing)
            + ". Set them in your deployment platform before starting Care WEDO.",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    validate_environment()
