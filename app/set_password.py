import getpass

from .auth import hasher

if __name__ == "__main__":
    pw = getpass.getpass("New password: ")
    if pw != getpass.getpass("Again: "):
        raise SystemExit("passwords differ")
    print("\nAdd this line to your .env (quote it, it contains $ signs):\n")
    print(f"PASSWORD_HASH='{hasher.hash(pw)}'")
