// --- GLOBAL STATE ---
let myToken = sessionStorage.getItem('userToken'); 
let myRole = null;
const gridDiv = document.getElementById('grid');
const btnDiv = document.getElementById('buttons');

// --- INITIALIZATION ---
// 1. Build Grid
for(let r=0; r<10; r++) {
    for(let c=0; c<10; c++) {
        let input = document.createElement('input');
        input.className = 'cell';
        input.maxLength = 1;
        input.id = `cell-${r}-${c}`;
        input.addEventListener('input', function() {
            input.value = input.value.toUpperCase();
            sendMove(r, c, input.value);
        });
        gridDiv.appendChild(input);
    }
}
// 2. Build Score Buttons
for(let i=0; i<10; i++) {
    let btn = document.createElement('button');
    btn.innerText = i;
    btn.onclick = function() { endTurn(i); };
    btnDiv.appendChild(btn);
}

// --- CORE FUNCTIONS ---
function startHeartbeat() {
    setInterval(() => {
        if(myRole && myToken) {
            fetch('/heartbeat', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({role: myRole, token: myToken})
            });
        }
    }, 2000); 
}

function joinGame(role) {
    fetch('/login', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({role: role, token: myToken})
    })
    .then(res => res.json())
    .then(data => {
        if(data.status === 'success') {
            myRole = role;
            myToken = data.token;
            sessionStorage.setItem('userToken', myToken);
            sessionStorage.setItem('playerRole', role);
            
            document.getElementById('login-overlay').classList.add('hidden');
            document.getElementById('my-role').innerText = `You are Player ${role}`;
            startHeartbeat();
            updateBoard();
        } else {
            document.getElementById('login-msg').innerText = data.message;
        }
    });
}

function sendMove(r, c, val) {
    fetch('/make_move', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({row: r, col: c, letter: val, role: myRole, token: myToken})
    })
    .then(res => res.json())
    .then(data => { if(data.status === 'error') console.log(data.message); });
}

function endTurn(points) {
    fetch('/end_turn', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({points: points, role: myRole, token: myToken})
    })
    .then(res => res.json())
    .then(data => {
        // FIX: If server says error (No move made), tell the user!
        if (data.status === 'error') {
            alert(data.message); 
        } else {
            // Only update board if successful
            renderState(data);
        }
    });
}

function resetGame() {
    if(confirm("Are you sure?")) {
        fetch('/reset', {method: 'POST'}).then(() => {
            document.getElementById('winner-overlay').classList.add('hidden');
            updateBoard();
        });
    }
}

function logout() {
    sessionStorage.clear();
    location.reload();
}

function setTarget() {
    let val = document.getElementById('target-score').value;
    fetch('/set_target', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({target: val})
    });
}

// --- RENDERING ---
function updateBoard() {
    fetch('/get_state')
    .then(res => res.json())
    .then(state => renderState(state));
}

function renderState(state) {
    document.getElementById('s1').innerText = state.scores[1];
    document.getElementById('s2').innerText = state.scores[2];
    
    let targetInput = document.getElementById('target-score');
    if(document.activeElement !== targetInput) targetInput.value = state.target_score;

    // Winner Check
    if (state.winner !== null) {
        document.getElementById('winner-text').innerText = `Player ${state.winner} Wins!`;
        document.getElementById('winner-overlay').classList.remove('hidden');
    } else {
        document.getElementById('winner-overlay').classList.add('hidden');
    }

    // Turn Indicator
    const turnDiv = document.getElementById('turn-indicator');
    turnDiv.innerText = `Player ${state.turn}'s Turn`;
    turnDiv.className = state.turn === 1 ? 'p1-turn' : 'p2-turn';

    // Grid Update
    state.board.forEach((row, r) => {
        row.forEach((char, c) => {
            let cell = document.getElementById(`cell-${r}-${c}`);
            if (document.activeElement !== cell) cell.value = char;
            
            let isPermLocked = state.locked_cells.some(pos => pos[0] === r && pos[1] === c);
            let isNotMyTurn = (state.turn !== myRole);
            let gameEnded = (state.winner !== null);
            cell.disabled = isPermLocked || isNotMyTurn || gameEnded;
        });
    });
    
    if(state.seats_taken[1]) document.getElementById('btn-p1').disabled = true;
    if(state.seats_taken[2]) document.getElementById('btn-p2').disabled = true;
}

// Auto-Login Check
let savedRole = sessionStorage.getItem('playerRole');
if (savedRole) joinGame(parseInt(savedRole));

// Polling Loop
setInterval(updateBoard, 1000);