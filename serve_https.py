#!/usr/bin/env python3
"""GEN.SWAGS — HTTPS-сервер для игры на iPhone.

Зачем: iOS Safari отдаёт гироскоп/датчики движения ТОЛЬКО в безопасном
контексте (HTTPS). Обычный `python -m http.server` (http://) молча ломает
гироскоп. Этот скрипт поднимает тот же статик-сервер, но по HTTPS
с самоподписанным сертификатом из dev/certs/.

Запуск (на ПК, из папки игры):
    python serve_https.py            # порт 8343

На iPhone:
    1. ПК и айфон в одной Wi-Fi сети.
    2. Узнай IP ПК:  ipconfig → «IPv4-адрес» (например 192.168.1.50).
    3. В Safari открой:  https://192.168.1.50:8343
    4. Предупреждение о сертификате: «Подробности» → «Перейти на сайт»
       (сертификат самоподписанный — это нормально, он ваш локальный).
    5. Настройки в игре → ГИРОСКОП → включи → iOS спросит разрешение.

Если cert.pem/key.pem нет — создаются автоматически (нужен openssl).
"""
import os
import ssl
import subprocess
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
CERT_DIR = os.path.join(ROOT, 'dev', 'certs')
CERT = os.path.join(CERT_DIR, 'cert.pem')
KEY = os.path.join(CERT_DIR, 'key.pem')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8343


def local_ip():
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


def ensure_cert():
    if os.path.exists(CERT) and os.path.exists(KEY):
        return True
    os.makedirs(CERT_DIR, exist_ok=True)
    ip = local_ip()
    cmd = [
        'openssl', 'req', '-x509', '-newkey', 'rsa:2048',
        '-keyout', KEY, '-out', CERT, '-days', '3650', '-nodes',
        '-subj', '/CN=gen.swags',
        '-addext', f'subjectAltName=IP:127.0.0.1,IP:{ip},DNS:localhost',
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        print(f'[certs] создан самоподписанный сертификат для {ip}')
        return True
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print('[certs] ОШИБКА: нужен openssl в PATH:', e)
        return False


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # Никакого кэша — чтобы правки сразу доезжали до айфона
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # тихий режим


def main():
    if not ensure_cert():
        sys.exit(1)
    ip = local_ip()
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT, KEY)
    server.socket = ctx.wrap_socket(server.socket, server_side=True)
    print('=' * 56)
    print('  GEN.SWAGS HTTPS-сервер запущен (для гироскопа на iPhone)')
    print(f'  На этом ПК:   https://localhost:{PORT}')
    print(f'  На iPhone:    https://{ip}:{PORT}')
    print('  (предупреждение сертификата → «Перейти на сайт»)')
    print('  Ctrl+C — остановить')
    print('=' * 56)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
