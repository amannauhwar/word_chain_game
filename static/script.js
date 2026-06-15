// --- GLOBAL STATE ---
let myToken = sessionStorage.getItem('userToken'); 
let myRole = null;
const gridDiv = document.getElementById('grid');
let currentActiveCellPos = null; // The tile placed this turn
let selectedCells = []; // Array of {r, c} objects
let seenAnnouncements = new Set();
let currentGridSize = 0;
let isSelectingMode = false;

let setupPlayers = null;

// --- TOAST NOTIFICATIONS ---
function showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showAnnouncement(msg) {
    const container = document.getElementById('announcement-container');
    const el = document.createElement('div');
    el.className = 'announcement';
    el.innerText = msg;
    container.appendChild(el);
    setTimeout(() => {
        el.style.animation = 'fadeOut 0.5s ease-in forwards';
        setTimeout(() => el.remove(), 500);
    }, 5000);
}

// --- SETUP & LOGIN ---
function setSetupPlayers(num) {
    setupPlayers = num;
    document.getElementById('sel-players').innerText = `Selected: ${num}`;
    document.querySelectorAll('.setup-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
}

function submitSetup() {
    if(!setupPlayers) return showToast("Please select number of players!");
    const grid = parseInt(document.getElementById('setup-grid').value);
    const target = parseInt(document.getElementById('setup-target').value);
    const timer = parseInt(document.getElementById('setup-timer').value) || 0;
    if(grid < 7 || grid > 12) return showToast("Grid must be between 7 and 12!");
    if(target < 10) return showToast("Target must be at least 10!");

    fetch('/setup_game', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({players: setupPlayers, grid_size: grid, target: target, turn_timer: timer})
    })
    .then(res => res.json())
    .then(data => {
        if(data.status === 'success') {
            updateBoard();
        } else {
            showToast(data.message);
        }
    });
}

function joinGame(role) {
    const name = document.getElementById('player-name-input').value;
    fetch('/login', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({role: role, token: myToken, name: name})
    })
    .then(res => res.json())
    .then(data => {
        if(data.status === 'success') {
            myRole = role;
            myToken = data.token;
            sessionStorage.setItem('userToken', myToken);
            sessionStorage.setItem('playerRole', role);
            
            document.getElementById('login-overlay').classList.add('hidden');
            document.getElementById('my-role').innerText = `Connecting...`;
            startHeartbeat();
            updateBoard();
        } else {
            document.getElementById('login-msg').innerText = data.message;
        }
    });
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

function getCellSize(gridSize) {
    const maxWidth = Math.min(window.innerWidth - 32, 700); // 16px padding each side, max 700
    const gap = 4;
    const totalGap = (gridSize - 1) * gap;
    const cellSize = Math.floor((maxWidth - totalGap) / gridSize);
    return Math.min(cellSize, 45); // cap at 45px for desktop
}

function buildGrid(size) {
    if(currentGridSize === size) return;
    currentGridSize = size;
    gridDiv.innerHTML = '';
    
    const cellSize = getCellSize(size);
    gridDiv.style.gridTemplateColumns = `repeat(${size}, ${cellSize}px)`;
    document.documentElement.style.setProperty('--cell-size', cellSize + 'px');
    document.documentElement.style.setProperty('--cell-font', Math.max(14, Math.floor(cellSize * 0.53)) + 'px');
    
    for(let r=0; r<size; r++) {
        for(let c=0; c<size; c++) {
            let input = document.createElement('input');
            input.className = 'cell';
            input.maxLength = 1;
            input.id = `cell-${r}-${c}`;
            
            // Handle clicking for selection vs typing
            input.addEventListener('click', (e) => {
                if(isSelectingMode) toggleSelection(r, c);
            });
            input.addEventListener('touchstart', (e) => {
                if(isSelectingMode && input.value) {
                    e.preventDefault();
                    toggleSelection(r, c);
                }
            });
            
            input.addEventListener('input', function() {
                input.value = input.value.toUpperCase();
                
                if(currentActiveCellPos) {
                    let prev = document.getElementById(`cell-${currentActiveCellPos.r}-${currentActiveCellPos.c}`);
                    if(prev) prev.classList.remove('active-cell');
                }
                
                if(input.value !== '') {
                    input.classList.add('active-cell');
                    currentActiveCellPos = {r, c};
                } else {
                    currentActiveCellPos = null;
                }
                
                sendMove(r, c, input.value);
            });
            
            gridDiv.appendChild(input);
        }
    }
}

// Recalculate grid on resize
window.addEventListener('resize', () => {
    if(currentGridSize > 0) {
        const cellSize = getCellSize(currentGridSize);
        gridDiv.style.gridTemplateColumns = `repeat(${currentGridSize}, ${cellSize}px)`;
        document.documentElement.style.setProperty('--cell-size', cellSize + 'px');
        document.documentElement.style.setProperty('--cell-font', Math.max(14, Math.floor(cellSize * 0.53)) + 'px');
    }
});

function toggleSelection(r, c) {
    let input = document.getElementById(`cell-${r}-${c}`);
    if(!input.value) return; // Cannot select empty cells
    
    // Check if already selected
    let idx = selectedCells.findIndex(s => s[0] === r && s[1] === c);
    if(idx > -1) {
        selectedCells.splice(idx, 1);
        input.classList.remove('selected-cell');
    } else {
        selectedCells.push([r, c]);
        input.classList.add('selected-cell');
    }
}

function clearSelection() {
    selectedCells.forEach(pos => {
        let el = document.getElementById(`cell-${pos[0]}-${pos[1]}`);
        if(el) el.classList.remove('selected-cell');
    });
    selectedCells = [];
}

function sendMove(r, c, val) {
    fetch('/make_move', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({row: r, col: c, letter: val, role: myRole, token: myToken})
    })
    .then(res => res.json())
    .then(data => { 
        if(data.status === 'error') {
            showToast(data.message); 
            let cell = document.getElementById(`cell-${r}-${c}`);
            cell.value = "";
            cell.classList.remove('active-cell');
            currentActiveCellPos = null;
        }
    });
}

function toggleSelectionMode() {
    isSelectingMode = !isSelectingMode;
    let btn = document.getElementById('select-word-btn');
    if(isSelectingMode) {
        btn.innerText = "Cancel Selection";
        btn.classList.add('danger-btn');
        btn.classList.remove('seat-btn');
    } else {
        btn.innerText = "Select Word";
        btn.classList.remove('danger-btn');
        btn.classList.add('seat-btn');
        clearSelection();
    }
}

function submitWord() {
    fetch('/end_turn', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({selected_cells: selectedCells, role: myRole, token: myToken})
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'error') {
            showToast(data.message); 
        } else {
            if(isSelectingMode) toggleSelectionMode(); // turn it off, which also clears selection
            currentActiveCellPos = null;
            renderState(data);
        }
    });
}

function resetGame() {
    if(confirm("Are you sure you want to reset the game? This will reset all players and settings.")) {
        fetch('/reset', {method: 'POST'}).then(() => {
            // Clear session so auto-login doesn't fire before setup
            sessionStorage.clear();
            myRole = null;
            myToken = null;
            document.getElementById('winner-overlay').classList.add('hidden');
            clearSelection();
            currentActiveCellPos = null;
            currentGridSize = 0; // force grid rebuild
            location.reload();
        });
    }
}

function logout() {
    if(myRole && myToken) {
        fetch('/leave', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({role: myRole, token: myToken})
        }).then(() => {
            sessionStorage.clear();
            location.reload();
        });
    } else {
        sessionStorage.clear();
        location.reload();
    }
}

// --- RENDERING ---
function updateBoard() {
    fetch('/get_state')
    .then(res => res.json())
    .then(state => renderState(state));
}

function renderState(state) {
    // Check for announcements
    if(state.announcements) {
        state.announcements.forEach(a => {
            if(!seenAnnouncements.has(a.id)) {
                seenAnnouncements.add(a.id);
                showAnnouncement(a.msg);
            }
        });
    }

    // --- LOBBY LOGIC ---
    if(!myRole && !state.winner) {
        document.getElementById('login-overlay').classList.remove('hidden');
        if(!state.total_players) {
            // Setup phase
            document.getElementById('setup-phase').classList.remove('hidden');
            document.getElementById('join-phase').classList.add('hidden');
        } else {
            // Join phase
            document.getElementById('setup-phase').classList.add('hidden');
            document.getElementById('join-phase').classList.remove('hidden');
            
            let btnContainer = document.getElementById('join-buttons');
            btnContainer.innerHTML = '';
            for(let i=1; i<=state.total_players; i++) {
                let btn = document.createElement('button');
                btn.className = 'seat-btn';
                btn.id = `btn-p${i}`;
                btn.innerText = `Join as Player ${i}`;
                btn.onclick = () => joinGame(i);
                if(state.seats_taken[i]) {
                    btn.disabled = true;
                    btn.innerText = `Player ${i} (Taken)`;
                }
                btnContainer.appendChild(btn);
            }
        }
    }

    // Build Grid dynamically if size changes
    if(state.grid_size) {
        buildGrid(state.grid_size);
    }

    // Update Player Names & Scores & Show/Hide boxes
    for(let i=1; i<=4; i++) {
        let sbox = document.getElementById(`score-box-${i}`);
        let sval = document.getElementById(`s${i}`);
        let name = document.getElementById(`name-${i}`);
        
        if(state.total_players && i <= state.total_players) {
            sbox.classList.remove('hidden');
        } else {
            sbox.classList.add('hidden');
        }
        
        if(state.scores[i] !== undefined) sval.innerText = state.scores[i];
        if(state.player_names[i]) name.innerText = state.player_names[i];
    }
    
    document.getElementById('display-target').innerText = state.target_score;

    // Winner Check
    if (state.winner !== null) {
        let winnerName = state.player_names[state.winner] || `Player ${state.winner}`;
        document.getElementById('winner-text').innerText = `${winnerName} Wins!`;
        document.getElementById('winner-overlay').classList.remove('hidden');
    } else {
        document.getElementById('winner-overlay').classList.add('hidden');
    }

    // Turn Indicator
    const turnDiv = document.getElementById('turn-indicator');
    if (state.total_players) {
        let tName = state.player_names[state.turn] || `Player ${state.turn}`;
        turnDiv.innerText = `${tName}'s Turn`;
        turnDiv.className = `p${state.turn}-turn`;
    }

    if (myRole && state.player_names[myRole]) {
        document.getElementById('my-role').innerText = `You are playing as ${state.player_names[myRole]}`;
    }

    // Timer Display (only for the player whose turn it is)
    let timerEl = document.getElementById('timer-display');
    let secondsEl = document.getElementById('timer-seconds');
    if (state.turn_time_limit && state.turn_time_limit > 0 && state.turn_remaining !== null && state.turn_remaining !== undefined && myRole === state.turn) {
        timerEl.classList.remove('hidden');
        let remaining = Math.ceil(state.turn_remaining);
        secondsEl.innerText = remaining;
        if (remaining <= 10) {
            timerEl.classList.add('warning');
        } else {
            timerEl.classList.remove('warning');
        }
    } else {
        timerEl.classList.add('hidden');
    }

    // Grid Update
    state.board.forEach((row, r) => {
        row.forEach((char, c) => {
            let cell = document.getElementById(`cell-${r}-${c}`);
            if(!cell) return;
            
            if (document.activeElement !== cell) cell.value = char;
            
            let isPermLocked = state.locked_cells.some(pos => pos[0] === r && pos[1] === c);
            let isNotMyTurn = (state.turn !== myRole);
            let gameEnded = (state.winner !== null);
            
            // Allow editing the cell the player just placed this turn
            let isMyActiveCell = !isPermLocked && !isNotMyTurn && !gameEnded
                && currentActiveCellPos && currentActiveCellPos.r === r && currentActiveCellPos.c === c;
            
            let shouldBeDisabled = isPermLocked || isNotMyTurn || gameEnded || (char !== '' && !isMyActiveCell);
            if (shouldBeDisabled) {
                cell.setAttribute('readonly', true);
            } else {
                cell.removeAttribute('readonly');
            }
            
            // Player-colored locked cells
            cell.classList.remove('cell-p1', 'cell-p2', 'cell-p3', 'cell-p4');
            if(isPermLocked) {
                cell.classList.remove('active-cell');
                let owner = state.cell_owners ? state.cell_owners[r + '-' + c] : null;
                if(owner) cell.classList.add('cell-p' + owner);
            }
        });
    });
}

// Auto-Login Check
let savedRole = sessionStorage.getItem('playerRole');
if (savedRole) joinGame(parseInt(savedRole));

// Polling Loop
setInterval(updateBoard, 1000);