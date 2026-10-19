import argparse
import getpass
import os

from .auth import hasher

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Hash a new password.")
    ap.add_argument("--file", help="write the hash to this file instead of printing it (used in Docker)")
    args = ap.parse_args()
    pw = getpass.getpass("New password: ")
    if len(pw) < 8:
        raise SystemExit("use at least 8 characters")
    if pw != getpass.getpass("Again: "):
        raise SystemExit("passwords differ")
    hashed = hasher.hash(pw)
    if args.file:
        with open(args.file, "w") as f:
            f.write(hashed)
        os.chmod(args.file, 0o600)
        print(f"saved to {args.file}")
    else:
        print("\nAdd this line to your .env (quote it, it contains $ signs):\n")
        print(f"PASSWORD_HASH='{hashed}'")
