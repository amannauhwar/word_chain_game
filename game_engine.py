import uuid
import time

class GameEngine:
    def __init__(self):
        self.grid_size = 10
        self.board = [['' for _ in range(self.grid_size)] for _ in range(self.grid_size)]
        self.scores = {1: 0, 2: 0, 3: 0, 4: 0}
        self.turn = 1
        self.locked_cells = []
        self.cell_owners = {}  # "r-c" -> player role
        self.seats = {1: None, 2: None, 3: None, 4: None}
        self.player_names = {1: "Player 1", 2: "Player 2", 3: "Player 3", 4: "Player 4"}
        self.target_score = 50
        self.winner = None
        self.last_seen = {1: 0, 2: 0, 3: 0, 4: 0}
        self.player_timeout = 600
        self.total_players = None  # 2, 3, or 4
        self.claimed_words = set()
        self.announcements = []
        self.turn_time_limit = 0  # 0 = no timer
        self.turn_start_time = None

    def clean_zombies(self):
        """Kicks out players who haven't sent a heartbeat recently"""
        now = time.time()
        for role in [1, 2, 3, 4]:
            if self.seats[role] is not None:
                if now - self.last_seen[role] > self.player_timeout:
                    print(f"Player {role} timed out.")
                    self.seats[role] = None

    def setup_game(self, num_players, grid_size, target_score, turn_timer=0):
        if self.total_players: return False
        self.total_players = num_players
        self.grid_size = grid_size
        self.target_score = target_score
        self.turn_time_limit = turn_timer
        self.turn_start_time = None  # starts when all players join
        self.board = [['' for _ in range(self.grid_size)] for _ in range(self.grid_size)]
        return True

    def try_login(self, role, token, name):
        self.clean_zombies()
        if name and name.strip():
            self.player_names[role] = name.strip()[:15] # limit name length

        if self.seats[role] is None:
            new_token = str(uuid.uuid4())
            self.seats[role] = new_token
            self.last_seen[role] = time.time()
            # Start timer when all players have joined
            if self.total_players and not self.turn_start_time:
                filled = sum(1 for i in range(1, self.total_players + 1) if self.seats[i] is not None)
                if filled == self.total_players:
                    self.turn_start_time = time.time()
            return {"status": "success", "token": new_token}
        
        elif self.seats[role] == token:
            self.last_seen[role] = time.time()
            return {"status": "success", "token": token}
            
        return {"status": "error", "message": "Seat taken"}

    def validate_move(self, role, token, r, c, letter):
        if self.winner: return "Game Over"
        if self.seats[role] != token: return "Invalid Identity"
        if role != self.turn: return "Not your turn"
        
        # Game Rule: One Box Only placed per turn
        if letter != "":
            for row in range(self.grid_size):
                for col in range(self.grid_size):
                    if (row != r or col != c):
                        if self.board[row][col] != "":
                            if [row, col] not in self.locked_cells:
                                return "Finish your current active tile first!"
        
        self.last_seen[role] = time.time()
        self.board[r][c] = letter
        return None

    def is_straight_line(self, cells):
        if len(cells) < 2: return True
        r0, c0 = cells[0]
        r1, c1 = cells[1]
        dr = r1 - r0
        dc = c1 - c0
        # Check if step is valid (horizontal, vertical, diagonal) and continuous
        if dr not in [-1, 0, 1] or dc not in [-1, 0, 1] or (dr == 0 and dc == 0):
            return False
        
        for i in range(1, len(cells)):
            if cells[i][0] - cells[i-1][0] != dr or cells[i][1] - cells[i-1][1] != dc:
                return False
        return True

    def end_turn(self, role, token, selected_cells):
        if self.winner: return "Game Over"
        if self.seats[role] != token or role != self.turn: return "Invalid Action"

        # The Free Lunch Rule: Ensure a new tile was placed
        new_tile_placed = False
        new_tile_pos = None
        for r in range(self.grid_size):
            for c in range(self.grid_size):
                if self.board[r][c] != "" and [r, c] not in self.locked_cells:
                    new_tile_placed = True
                    new_tile_pos = [r, c]
                    break
        
        if not new_tile_placed:
            return "You must place a letter before ending your turn!"
            
        points = 0
        word = ""
        
        if len(selected_cells) > 0:
            if not self.is_straight_line(selected_cells):
                return "Selected word must be in a continuous straight line!"
                
            if new_tile_pos not in selected_cells:
                return "Your selected word must include the letter you just placed!"
                
            word_chars = []
            for r, c in selected_cells:
                char = self.board[r][c]
                if not char: return "Selected cells cannot be empty!"
                word_chars.append(char)
            
            word = "".join(word_chars)
            rev_word = word[::-1]
            
            if word in self.claimed_words or rev_word in self.claimed_words:
                return f"The word '{word}' has already been claimed!"
                
            self.claimed_words.add(word)
            points = len(word)

        self.last_seen[role] = time.time()
        self.scores[self.turn] += points
        
        if points > 0:
            msg = f"{self.player_names[role]} played '{word}' for {points} pts!"
            self.announcements.append({"id": str(uuid.uuid4()), "msg": msg})

        if self.scores[self.turn] >= self.target_score:
            self.winner = self.turn

        # Lock Cells
        if new_tile_pos:
            self.locked_cells.append(new_tile_pos)
            self.cell_owners[f"{new_tile_pos[0]}-{new_tile_pos[1]}"] = role
        
        # Cycle turn
        if self.total_players:
            self.turn = self.turn + 1 if self.turn < self.total_players else 1
        else:
            self.turn = 2 if self.turn == 1 else 1

        self.turn_start_time = time.time()
        return None

    def check_turn_timeout(self):
        """Auto-skip turn if timer expired"""
        if self.turn_time_limit <= 0 or self.winner or not self.turn_start_time:
            return
        if not self.total_players:
            return
        if time.time() - self.turn_start_time > self.turn_time_limit:
            # Clear any unlocked letter placed this turn
            for r in range(self.grid_size):
                for c in range(self.grid_size):
                    if self.board[r][c] != '' and [r, c] not in self.locked_cells:
                        self.board[r][c] = ''

            msg = f"{self.player_names[self.turn]}'s turn timed out!"
            self.announcements.append({"id": str(uuid.uuid4()), "msg": msg})

            # Cycle turn
            self.turn = self.turn + 1 if self.turn < self.total_players else 1
            self.turn_start_time = time.time()

    def reset(self):
        self.board = [['' for _ in range(self.grid_size)] for _ in range(self.grid_size)]
        self.scores = {1: 0, 2: 0, 3: 0, 4: 0}
        self.turn = 1
        self.locked_cells = []
        self.cell_owners = {}
        self.winner = None
        self.total_players = None
        self.seats = {1: None, 2: None, 3: None, 4: None}
        self.claimed_words = set()
        self.announcements = []
        self.player_names = {1: "Player 1", 2: "Player 2", 3: "Player 3", 4: "Player 4"}
        self.grid_size = 10
        self.turn_time_limit = 0
        self.turn_start_time = None

    def get_state_dict(self):
        self.clean_zombies()
        self.check_turn_timeout()
        
        turn_remaining = None
        if self.turn_time_limit > 0 and self.turn_start_time:
            turn_remaining = max(0, self.turn_time_limit - (time.time() - self.turn_start_time))
        
        return {
            "board": self.board,
            "grid_size": self.grid_size,
            "scores": self.scores,
            "turn": self.turn,
            "locked_cells": self.locked_cells,
            "cell_owners": self.cell_owners,
            "seats_taken": {i: self.seats[i] is not None for i in range(1, 5)},
            "player_names": self.player_names,
            "target_score": self.target_score,
            "winner": self.winner,
            "total_players": self.total_players,
            "turn_time_limit": self.turn_time_limit,
            "turn_remaining": turn_remaining,
            "announcements": self.announcements[-3:] # send only last 3 to keep payload small
        }