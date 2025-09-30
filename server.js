// Import necessary modules
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { createClient } = require('@supabase/supabase-js');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = 'https://zbzwgvnxrrjvwgnobmom.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpiendndm54cnJqdndnbm9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkxNzE1NDIsImV4cCI6MjA3NDc0NzU0Mn0.TuaeOFaOouijWCO0WWYww5nO5x6h5aNt7mcViteXjp0';

// --- INITIALIZATION ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- DATABASE FUNCTIONS ---

// Function to get the latest code for a room from Supabase
async function getRoomCode(room) {
    const { data, error } = await supabase
        .from('code_rooms')
        .select('content')
        .eq('room_id', room)
        .single(); // Use .single() to get a single object, not an array

    if (error && error.code !== 'PGRST116') { // PGRST116 = "No rows found"
        console.error('Error fetching room code:', error);
        return ''; // Return empty string on error
    }
    return data ? data.content : ''; // If data exists, return content, else empty string
}

// Function to save code to a room, updating if it exists or inserting if new
async function saveRoomCode(room, content) {
    const { error } = await supabase
        .from('code_rooms')
        .upsert({ room_id: room, content: content, last_updated: new Date() }, { onConflict: 'room_id' });

    if (error) {
        console.error('Error saving room code:', error);
    }
}

// --- EXPRESS ROUTE ---

// Serve the main HTML page
app.get('/', (req, res) => {
    res.send(getHtmlContent());
});

// --- SOCKET.IO LOGIC ---

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // When a user joins a room
    socket.on('joinRoom', async ({ room }) => {
        socket.join(room);
        console.log(`${socket.id} joined room: ${room}`);

        // Fetch the latest code from Supabase for that room
        const initialCode = await getRoomCode(room);

        // Send the code only to the user who just joined
        socket.emit('initialCode', initialCode);

        // Notify others in the room
        socket.to(room).emit('systemMessage', 'A new user has joined the session.');
    });

    // When the code is changed by a user
    socket.on('codeChange', (data) => {
        const { room, code } = data;
        // Broadcast the change to everyone else in the room
        socket.to(room).emit('codeUpdate', code);
    });

    // When a user stops typing, save the code to the database
    socket.on('saveCode', async (data) => {
        const { room, code } = data;
        await saveRoomCode(room, code);
        // Optional: notify others that the code was saved
        socket.to(room).emit('systemMessage', 'Code saved to the cloud.');
        console.log(`Code for room ${room} saved.`);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

// --- START SERVER ---
server.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});


// --- FRONTEND HTML, CSS, and JS ---

function getHtmlContent() {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Real-Time Collaborative Code Editor</title>
    <style>
        /* Basic CSS Reset & Styling */
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background: #1e1e1e;
            color: #d4d4d4;
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }

        /* Header Styling */
        .header {
            background: #252526;
            padding: 10px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #333;
        }
        .header h1 {
            font-size: 1.2em;
            font-weight: 500;
        }
        .room-controls {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        .room-controls input {
            padding: 8px 12px;
            border: 1px solid #3c3c3c;
            background: #333;
            color: #d4d4d4;
            border-radius: 6px;
            font-size: 1em;
            width: 150px;
        }
        .room-controls input:focus {
            outline: none;
            border-color: #007acc;
        }

        /* Main Editor Area */
        main {
            flex-grow: 1;
            position: relative;
        }
        #editor {
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            left: 0;
            font-size: 16px;
            line-height: 1.5;
        }

        /* Footer Status Bar */
        .footer {
            background: #007acc;
            color: white;
            padding: 5px 20px;
            text-align: center;
            font-size: 0.9em;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
    </style>
    <!-- ACE Editor Library -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.35.1/ace.js"></script>
</head>
<body>

    <header class="header">
        <h1>CodeSync Live</h1>
        <div class="room-controls">
            <label for="room-id">Room ID:</label>
            <input type="text" id="roomId" placeholder="Enter a room ID...">
        </div>
    </header>

    <main>
        <div id="editor"></div>
    </main>

    <footer class="footer">
        <div id="status">Enter a Room ID to start collaborating.</div>
    </footer>

    <!-- Socket.IO client library -->
    <script src="/socket.io/socket.io.js"></script>

    <script>
        // --- CLIENT-SIDE LOGIC ---

        // Initialize Ace Editor
        const editor = ace.edit("editor");
        editor.setTheme("ace/theme/tomorrow_night_eighties");
        editor.session.setMode("ace/mode/javascript");
        editor.setValue('// Welcome to CodeSync Live!\\n// Enter a Room ID above to start or join a session.\\n', -1);
        editor.setReadOnly(true); // Start as read-only

        // DOM Elements
        const roomIdInput = document.getElementById('roomId');
        const statusDiv = document.getElementById('status');
        
        // Socket.IO Connection
        const socket = io();
        let currentRoom = '';
        let typingTimer; // Timer to detect when user stops typing
        const DONE_TYPING_INTERVAL = 1500; // 1.5 seconds

        // --- EVENT LISTENERS ---

        // Listen for changes in the Room ID input
        roomIdInput.addEventListener('change', () => {
            const room = roomIdInput.value.trim();
            if (room && room !== currentRoom) {
                currentRoom = room;
                editor.setReadOnly(false);
                statusDiv.textContent = \`Connected to room: \${currentRoom}\`;
                socket.emit('joinRoom', { room: currentRoom });
            } else if (!room) {
                editor.setReadOnly(true);
                editor.setValue('// Enter a Room ID to start.', -1);
                statusDiv.textContent = 'Disconnected. Enter a Room ID.';
            }
        });

        // Listen for user typing in the editor
        editor.session.on('change', () => {
            if (editor.curOp && editor.curOp.command.name) {
                const code = editor.getValue();
                socket.emit('codeChange', { room: currentRoom, code });

                // Reset the timer and set a new one to save the code
                clearTimeout(typingTimer);
                typingTimer = setTimeout(() => {
                    socket.emit('saveCode', { room: currentRoom, code });
                }, DONE_TYPING_INTERVAL);
            }
        });


        // --- SOCKET EVENT HANDLERS ---

        // On receiving the initial code for a room
        socket.on('initialCode', (code) => {
            if (code) {
                editor.setValue(code, -1); // -1 moves cursor to start
            } else {
                editor.setValue(\`// Welcome to room: \${currentRoom}\\n// Start coding!\\n\`, -1);
            }
        });

        // On receiving a code update from another user
        socket.on('codeUpdate', (code) => {
            // To prevent cursor jumping, we save the current cursor position
            const cursorPos = editor.getCursorPosition();
            editor.setValue(code, cursorPos); // Set content without moving local cursor
            editor.moveCursorToPosition(cursorPos);
        });
        
        // On receiving a system message
        socket.on('systemMessage', (message) => {
             statusDiv.textContent = message;
             // Reset status after a few seconds
             setTimeout(() => {
                 statusDiv.textContent = \`Connected to room: \${currentRoom}\`;
             }, 3000);
        });

    </script>
</body>
</html>
    `;
}

