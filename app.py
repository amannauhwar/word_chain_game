from flask import Flask, jsonify, request, render_template
from game_engine import GameEngine
import logging
from datetime import datetime

app = Flask(__name__)
game = GameEngine()

# Fully suppress Flask/Werkzeug default access logs (they always show 127.0.0.1 behind tunnel)
class SuppressFilter(logging.Filter):
    def filter(self, record):
        return False

log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)
log.addFilter(SuppressFilter())

# Store player IPs: role -> IP
player_ips = {}

def get_real_ip():
    """Get real client IP behind Cloudflare tunnel"""
    # Cloudflare sets this header with the original client IP
    ip = request.headers.get('CF-Connecting-IP')
    if not ip:
        ip = request.headers.get('X-Forwarded-For', '').split(',')[0].strip()
    if not ip:
        ip = request.remote_addr
    # Strip IPv6-mapped IPv4 prefix (e.g. ::ffff:192.168.1.1 -> 192.168.1.1)
    if ip and ip.startswith('::ffff:'):
        ip = ip[7:]
    return ip

@app.after_request
def log_request(response):
    """Custom access log — only log important actions, skip heartbeat/polling spam"""
    skip_paths = {'/heartbeat', '/get_state', '/static'}
    if request.path in skip_paths or request.path.startswith('/static'):
        return response
    ip = get_real_ip()
    now = datetime.now().strftime('%d/%b/%Y %H:%M:%S')
    print(f'{ip} - - [{now}] "{request.method} {request.path} HTTP/1.1" {response.status_code}')
    return response

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    role = int(data['role'])
    ip = get_real_ip()
    result = game.try_login(role, data.get('token'), data.get('name', ''))
    if result.get('status') == 'success':
        player_ips[role] = ip
        name = data.get('name', '').strip() or f'Player {role}'
        print(f"\n{'='*50}")
        print(f"  🎮 PLAYER JOINED: {name} (Player {role})")
        print(f"  🌐 IP Address: {ip}")
        print(f"  📋 Active Players:")
        for r, pip in sorted(player_ips.items()):
            pname = game.player_names.get(r, f'Player {r}')
            print(f"     Player {r} ({pname}): {pip}")
        print(f"{'='*50}\n")
    return jsonify(result)

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    data = request.json
    role, token = int(data.get('role')), data.get('token')
    if game.seats[role] == token:
        game.last_seen[role] = __import__('time').time()
        return jsonify({"status": "ok"})
    return jsonify({"status": "error"})

@app.route('/get_state')
def get_state():
    return jsonify(game.get_state_dict())

@app.route('/make_move', methods=['POST'])
def make_move():
    data = request.json
    error = game.validate_move(
        int(data['role']), data['token'], 
        int(data['row']), int(data['col']), data['letter'].upper()
    )
    if error: return jsonify({"status": "error", "message": error})
    return jsonify({"status": "success"})

@app.route('/end_turn', methods=['POST'])
def end_turn():
    data = request.json
    error = game.end_turn(int(data['role']), data['token'], data.get('selected_cells', []))
    if error: return jsonify({"status": "error", "message": error})
    return jsonify(game.get_state_dict())

@app.route('/setup_game', methods=['POST'])
def setup_game():
    data = request.json
    num = int(data.get('players', 2))
    grid_size = int(data.get('grid_size', 10))
    target = int(data.get('target', 50))
    turn_timer = int(data.get('turn_timer', 0))
    
    if game.setup_game(num, grid_size, target, turn_timer):
        return jsonify({"status": "success"})
    return jsonify({"status": "error", "message": "Game already set up"})

@app.route('/leave', methods=['POST'])
def leave():
    data = request.json
    role = int(data.get('role'))
    token = data.get('token')
    if game.seats.get(role) == token:
        name = game.player_names.get(role, f'Player {role}')
        ip = player_ips.pop(role, 'unknown')
        game.seats[role] = None
        print(f"\n  👋 PLAYER LEFT: {name} (Player {role}) — IP: {ip}\n")
        return jsonify({"status": "success"})
    return jsonify({"status": "error", "message": "Invalid session"})

@app.route('/reset', methods=['POST'])
def reset():
    game.reset()
    player_ips.clear()
    print("\n  🔄 GAME RESET — All players cleared\n")
    return jsonify({"status": "reset"})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
