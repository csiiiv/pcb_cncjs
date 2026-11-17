#!/usr/bin/env python3

import socket
import struct
import subprocess
import time
from datetime import datetime


NTP_PORT = 123
NTP_EPOCH = 2208988800  # Seconds between 1900 and 1970


def get_local_ips():
    """
    Return all non-loopback global IPv4 addresses on Linux.
    """
    try:
        output = subprocess.check_output(
            ["ip", "-4", "-o", "addr", "show", "scope", "global"],
            text=True
        )

        addresses = []

        for line in output.splitlines():
            parts = line.split()

            interface = parts[1]
            ip_with_prefix = parts[3]
            ip_address = ip_with_prefix.split("/")[0]

            addresses.append((interface, ip_address))

        return addresses

    except Exception:
        return []


def ntp_timestamp():
    """
    Return the current system time as an 8-byte NTP timestamp.
    """
    t = time.time() + NTP_EPOCH

    seconds = int(t)
    fraction = int((t - seconds) * (1 << 32))

    return struct.pack("!II", seconds, fraction)


def build_ntp_response(request):
    """
    Build a basic NTP server response from a client request.
    """

    # NTP packet must be at least 48 bytes.
    if len(request) < 48:
        return None

    client_flags = request[0]

    # Extract client's requested NTP version.
    version = (client_flags >> 3) & 0x07

    # Fall back to NTPv4 if client sends something invalid.
    if version == 0:
        version = 4

    # LI = 0  -> no warning
    # VN = client's version
    # Mode = 4 -> server
    response_flags = (0 << 6) | (version << 3) | 4

    response = bytearray(48)

    # Leap Indicator / Version / Mode
    response[0] = response_flags

    # Stratum
    #
    # We claim stratum 1 here because this is intentionally serving
    # the Linux machine's local system clock.
    response[1] = 1

    # Poll interval
    response[2] = 6

    # Precision
    # Signed 8-bit value. -20 is roughly microsecond precision.
    response[3] = (-20) & 0xFF

    # Root Delay: 0
    response[4:8] = struct.pack("!I", 0)

    # Root Dispersion: 0
    response[8:12] = struct.pack("!I", 0)

    # Reference ID
    response[12:16] = b"LOCL"

    receive_time = ntp_timestamp()

    # Reference Timestamp
    response[16:24] = receive_time

    # Originate Timestamp:
    # copy client's transmit timestamp from request
    response[24:32] = request[40:48]

    # Receive Timestamp
    response[32:40] = receive_time

    # Transmit Timestamp
    response[40:48] = ntp_timestamp()

    return response


def main():
    print()
    print("=" * 60)
    print(" Temporary Local NTP Server")
    print("=" * 60)

    print(f"System time : {datetime.now().astimezone()}")
    print(f"UDP port    : {NTP_PORT}")
    print()

    local_ips = get_local_ips()

    if local_ips:
        print("Available NTP server addresses:")
        print()

        for interface, ip in local_ips:
            print(f"  {interface:<15} {ip}")

    else:
        print("WARNING: Could not determine local IPv4 addresses.")

    print()
    print("Configure your device to use one of the above IP addresses")
    print("as its NTP server.")
    print()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    try:
        sock.bind(("0.0.0.0", NTP_PORT))

    except PermissionError:
        print("ERROR: UDP port 123 requires root privileges.")
        print()
        print("Run this script using:")
        print()
        print("    sudo python3 ntp_server.py")
        print()
        return

    except OSError as e:
        print(f"ERROR: Could not bind UDP port {NTP_PORT}: {e}")
        print()
        print("Another NTP service may already be using port 123.")
        print()
        print("Check using:")
        print()
        print("    sudo ss -lunp | grep ':123'")
        print()
        return

    print("-" * 60)
    print("Waiting for NTP requests...")
    print("Press Ctrl+C to stop.")
    print("-" * 60)
    print()

    request_count = 0

    try:
        while True:
            data, addr = sock.recvfrom(1024)

            client_ip = addr[0]
            client_port = addr[1]

            timestamp = datetime.now().astimezone().strftime(
                "%Y-%m-%d %H:%M:%S %z"
            )

            if len(data) < 48:
                print(
                    f"[{timestamp}] "
                    f"Invalid packet from {client_ip}:{client_port} "
                    f"({len(data)} bytes)"
                )
                continue

            response = build_ntp_response(data)

            if response is None:
                continue

            sock.sendto(response, addr)

            request_count += 1

            version = (data[0] >> 3) & 0x07
            mode = data[0] & 0x07

            print(
                f"[{timestamp}] "
                f"Request #{request_count} from "
                f"{client_ip}:{client_port} "
                f"(NTPv{version}, mode={mode})"
            )

    except KeyboardInterrupt:
        print()
        print("-" * 60)
        print(f"NTP server stopped. Served {request_count} request(s).")

    finally:
        sock.close()


if __name__ == "__main__":
    main()