// ============================================
// CONFIGURATION
// ============================================
const ROCKETCHAT_HOST = 'localhost';
const ROCKETCHAT_PORT = '3001';
const ROCKETCHAT_URL = `http://${ROCKETCHAT_HOST}:${ROCKETCHAT_PORT}`;
const WEBSOCKET_URL = `ws://${ROCKETCHAT_HOST}:${ROCKETCHAT_PORT}/websocket`;

// ============================================
// STATE
// ============================================
let authToken = null;
let userId = null;
let username = null;
let currentRoomId = 'GENERAL';
let currentRoomType = 'channel'; // 'channel' or 'dm'
let currentRoomName = '#general';
let ws = null;
let wsConnected = false;
let messageIdCounter = 1;
let subscribedRooms = new Set();

// Voice recording
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// ============================================
// LOGGING
// ============================================
function log(message, type = 'info') {
    const panel = document.getElementById('debug-panel');
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    panel.insertBefore(entry, panel.firstChild);
    if (panel.children.length > 50) panel.removeChild(panel.lastChild);
    console.log(`[${type.toUpperCase()}]`, message);
}

function setStatus(text, type = '') {
    const bar = document.getElementById('status-bar');
    bar.textContent = text;
    bar.className = type;
}

// ============================================
// LOGIN
// ============================================
async function login() {
    const usernameInput = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    log(`Logging in as "${usernameInput}"...`);
    setStatus('Logging in...', '');

    try {
        const response = await fetch(`${ROCKETCHAT_URL}/api/v1/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: usernameInput, password })
        });

        const data = await response.json();

        if (data.status === 'success') {
            authToken = data.data.authToken;
            userId = data.data.userId;
            username = usernameInput;

            log(`Login successful! userId: ${userId}`, 'success');

            document.getElementById('login-overlay').classList.add('hidden');
            document.getElementById('logged-user').textContent = username;

            // Load data
            await loadUsers();
            await loadChannels();
            await loadDMs();
            await switchRoom('GENERAL', 'channel', '#general');

            // Connect WebSocket
            connectWebSocket();

        } else {
            log(`Login failed: ${data.message || data.error}`, 'error');
            setStatus('Login failed', 'error');
        }
    } catch (error) {
        log(`Login error: ${error.message}`, 'error');
        setStatus('Connection error', 'error');
    }
}

// ============================================
// LOAD DATA
// ============================================
async function loadUsers() {
    log('Loading users...');
    try {
        const response = await fetch(`${ROCKETCHAT_URL}/api/v1/users.list`, {
            headers: {
                'X-Auth-Token': authToken,
                'X-User-Id': userId
            }
        });
        const data = await response.json();

        if (data.success) {
            const container = document.getElementById('users-list');
            container.innerHTML = '';

            data.users.forEach(user => {
                if (user.username === username) return; // Skip self

                const div = document.createElement('div');
                div.className = 'user-item';
                div.innerHTML = `
                    <span class="status-dot ${user.status === 'online' ? 'online' : ''}"></span>
                    ${escapeHtml(user.username)}
                `;
                div.onclick = () => startDM(user.username);
                container.appendChild(div);
            });

            log(`Loaded ${data.users.length} users`, 'success');
        }
    } catch (error) {
        log(`Error loading users: ${error.message}`, 'error');
    }
}

async function loadChannels() {
    log('Loading channels...');
    try {
        const response = await fetch(`${ROCKETCHAT_URL}/api/v1/channels.list.joined`, {
            headers: {
                'X-Auth-Token': authToken,
                'X-User-Id': userId
            }
        });
        const data = await response.json();

        if (data.success) {
            const container = document.getElementById('channels-list');
            container.innerHTML = '';

            data.channels.forEach(channel => {
                const div = document.createElement('div');
                div.className = 'room-item';
                div.dataset.room = channel._id;
                div.dataset.type = 'channel';
                div.textContent = `# ${channel.name}`;
                div.onclick = () => switchRoom(channel._id, 'channel', `#${channel.name}`);
                container.appendChild(div);
            });

            log(`Loaded ${data.channels.length} channels`, 'success');
        }
    } catch (error) {
        log(`Error loading channels: ${error.message}`, 'error');
    }
}

async function loadDMs() {
    log('Loading DMs...');
    try {
        const response = await fetch(`${ROCKETCHAT_URL}/api/v1/im.list`, {
            headers: {
                'X-Auth-Token': authToken,
                'X-User-Id': userId
            }
        });
        const data = await response.json();

        if (data.success) {
            const container = document.getElementById('dm-list');
            container.innerHTML = '';

            data.ims.forEach(dm => {
                // Get the other user's name
                const otherUser = dm.usernames.find(u => u !== username) || dm.usernames[0];

                const div = document.createElement('div');
                div.className = 'room-item';
                div.dataset.room = dm._id;
                div.dataset.type = 'dm';
                div.innerHTML = `<span class="status-dot"></span> ${escapeHtml(otherUser)}`;
                div.onclick = () => switchRoom(dm._id, 'dm', otherUser);
                container.appendChild(div);
            });

            log(`Loaded ${data.ims.length} DMs`, 'success');
        }
    } catch (error) {
        log(`Error loading DMs: ${error.message}`, 'error');
    }
}

// ============================================
// ROOM MANAGEMENT
// ============================================
async function switchRoom(roomId, roomType, roomName) {
    log(`Switching to room: ${roomName} (${roomId})`);

    currentRoomId = roomId;
    currentRoomType = roomType;
    currentRoomName = roomName;

    // Update UI
    document.getElementById('current-room-name').textContent =
        roomType === 'channel' ? roomName : `DM: ${roomName}`;

    // Update active state
    document.querySelectorAll('.room-item').forEach(el => {
        el.classList.toggle('active', el.dataset.room === roomId);
    });

    // Clear messages
    document.getElementById('messages').innerHTML = '';

    // Load messages
    await loadMessages(roomId, roomType);

    // Subscribe to room via WebSocket
    if (wsConnected && !subscribedRooms.has(roomId)) {
        subscribeToRoom(roomId);
    }
}

async function startDM(targetUsername) {
    log(`Starting DM with ${targetUsername}...`);

    try {
        // Create or get existing DM
        const response = await fetch(`${ROCKETCHAT_URL}/api/v1/im.create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': authToken,
                'X-User-Id': userId
            },
            body: JSON.stringify({ username: targetUsername })
        });

        const data = await response.json();

        if (data.success) {
            const roomId = data.room._id;
            log(`DM room created/found: ${roomId}`, 'success');

            // Reload DMs list
            await loadDMs();

            // Switch to the DM
            await switchRoom(roomId, 'dm', targetUsername);
        } else {
            log(`Failed to create DM: ${data.error}`, 'error');
        }
    } catch (error) {
        log(`Error creating DM: ${error.message}`, 'error');
    }
}

async function loadMessages(roomId, roomType) {
    log(`Loading messages for ${roomId}...`);

    try {
        const endpoint = roomType === 'channel'
            ? `${ROCKETCHAT_URL}/api/v1/channels.messages?roomId=${roomId}&count=50`
            : `${ROCKETCHAT_URL}/api/v1/im.messages?roomId=${roomId}&count=50`;

        const response = await fetch(endpoint, {
            headers: {
                'X-Auth-Token': authToken,
                'X-User-Id': userId
            }
        });

        const data = await response.json();

        if (data.success && data.messages) {
            const messages = data.messages.reverse();
            messages.forEach(msg => displayMessage(msg));
            log(`Loaded ${messages.length} messages`, 'success');
        }
    } catch (error) {
        log(`Error loading messages: ${error.message}`, 'error');
    }
}

// ============================================
// SEND MESSAGE
// ============================================
async function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();

    if (!text) return;

    log(`Sending: "${text}"`);

    try {
        const response = await fetch(`${ROCKETCHAT_URL}/api/v1/chat.postMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': authToken,
                'X-User-Id': userId
            },
            body: JSON.stringify({
                roomId: currentRoomId,
                text: text
            })
        });

        const data = await response.json();

        if (data.success) {
            log('Message sent!', 'success');
            input.value = '';
        } else {
            log(`Send failed: ${data.error}`, 'error');
        }
    } catch (error) {
        log(`Send error: ${error.message}`, 'error');
    }
}

// ============================================
// VOICE RECORDING
// ============================================
let currentStream = null;
let selectedMimeType = null;

function getSupportedMimeType() {
    const types = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
        'audio/mpeg',
        'audio/wav'
    ];
    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
            log(`Supported audio format: ${type}`, 'success');
            return type;
        }
    }
    log('No supported audio format found!', 'error');
    return null;
}

async function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

async function startRecording() {
    log('Starting voice recording...');

    // Check for MediaRecorder support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        log('getUserMedia not supported!', 'error');
        alert('Your browser does not support audio recording.');
        return;
    }

    selectedMimeType = getSupportedMimeType();
    if (!selectedMimeType) {
        alert('Your browser does not support any audio recording format.');
        return;
    }

    try {
        currentStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        log('Microphone access granted', 'success');

        const options = { mimeType: selectedMimeType };
        mediaRecorder = new MediaRecorder(currentStream, options);
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            log(`Audio chunk received: ${e.data.size} bytes`);
            if (e.data.size > 0) {
                audioChunks.push(e.data);
            }
        };

        mediaRecorder.onerror = (e) => {
            log(`MediaRecorder error: ${e.error}`, 'error');
        };

        mediaRecorder.onstop = async () => {
            log(`Recording stopped. Total chunks: ${audioChunks.length}`);

            const mimeBase = selectedMimeType.split(';')[0];
            const audioBlob = new Blob(audioChunks, { type: mimeBase });
            log(`Audio blob created: ${(audioBlob.size / 1024).toFixed(1)} KB, type: ${mimeBase}`);

            // Stop all tracks
            if (currentStream) {
                currentStream.getTracks().forEach(track => track.stop());
                currentStream = null;
            }

            // Send the audio
            if (audioBlob.size > 0) {
                await sendVoiceMessage(audioBlob, mimeBase);
            } else {
                log('Audio blob is empty!', 'error');
            }
        };

        // Request data every 250ms to ensure we get chunks
        mediaRecorder.start(250);
        isRecording = true;

        document.getElementById('btn-voice').classList.add('recording');
        document.getElementById('btn-voice').textContent = '⏹';

        log(`Recording started with ${selectedMimeType}...`, 'success');

    } catch (error) {
        log(`Microphone error: ${error.name} - ${error.message}`, 'error');
        alert(`Could not access microphone: ${error.message}`);
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        log('Stopping recording...');
        mediaRecorder.stop();
        isRecording = false;

        document.getElementById('btn-voice').classList.remove('recording');
        document.getElementById('btn-voice').textContent = '🎤';
    }
}

async function sendVoiceMessage(audioBlob, mimeType) {
    log(`Uploading voice message (${(audioBlob.size / 1024).toFixed(1)} KB)...`);

    // Determine file extension
    let ext = 'webm';
    if (mimeType.includes('ogg')) ext = 'ogg';
    else if (mimeType.includes('mp4')) ext = 'mp4';
    else if (mimeType.includes('mpeg')) ext = 'mp3';
    else if (mimeType.includes('wav')) ext = 'wav';

    const fileName = `voice-${Date.now()}.${ext}`;
    log(`Filename: ${fileName}, MimeType: ${mimeType}`);

    try {
        const formData = new FormData();
        formData.append('file', audioBlob, fileName);
        formData.append('description', 'Voice message');

        log(`Sending to: ${ROCKETCHAT_URL}/api/v1/rooms.upload/${currentRoomId}`);

        const response = await fetch(`${ROCKETCHAT_URL}/api/v1/rooms.upload/${currentRoomId}`, {
            method: 'POST',
            headers: {
                'X-Auth-Token': authToken,
                'X-User-Id': userId
            },
            body: formData
        });

        log(`Response status: ${response.status}`);

        if (!response.ok) {
            const text = await response.text();
            log(`HTTP Error: ${response.status} - ${text}`, 'error');
            return;
        }

        const data = await response.json();

        if (data.success) {
            log('Voice message sent!', 'success');
        } else {
            log(`Upload failed: ${JSON.stringify(data)}`, 'error');
        }
    } catch (error) {
        log(`Upload error: ${error.name} - ${error.message}`, 'error');
        console.error('Full error:', error);
    }
}

// ============================================
// WEBSOCKET
// ============================================
function connectWebSocket() {
    log(`Connecting to WebSocket...`);
    setStatus('Connecting...', '');

    ws = new WebSocket(WEBSOCKET_URL);

    ws.onopen = () => {
        log('WebSocket connected', 'success');
        wsConnected = true;

        // DDP connect
        wsSend({ msg: 'connect', version: '1', support: ['1'] });
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    ws.onerror = (error) => {
        log(`WebSocket error`, 'error');
        setStatus('WebSocket error', 'error');
    };

    ws.onclose = () => {
        log('WebSocket disconnected', 'error');
        wsConnected = false;
        subscribedRooms.clear();
        setStatus('Disconnected', 'error');

        // Reconnect after 3 seconds
        setTimeout(() => {
            if (authToken) {
                log('Reconnecting...');
                connectWebSocket();
            }
        }, 3000);
    };
}

function wsSend(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}

function handleWebSocketMessage(data) {
    switch (data.msg) {
        case 'connected':
            log('DDP Connected', 'success');
            setStatus('Connected', 'connected');
            wsLogin();
            break;

        case 'ping':
            wsSend({ msg: 'pong' });
            break;

        case 'result':
            if (data.id === 'login-1') {
                log('WebSocket authenticated', 'success');
                subscribeToRoom(currentRoomId);
            }
            break;

        case 'changed':
            if (data.collection === 'stream-room-messages') {
                const args = data.fields?.args;
                if (args && args.length > 0) {
                    const msg = args[0];
                    if (msg.rid === currentRoomId) {
                        displayMessage(msg);
                    }
                }
            }
            break;

        case 'ready':
            log('Subscription ready', 'success');
            break;
    }
}

function wsLogin() {
    wsSend({
        msg: 'method',
        method: 'login',
        id: 'login-1',
        params: [{ resume: authToken }]
    });
}

function subscribeToRoom(roomId) {
    if (subscribedRooms.has(roomId)) return;

    log(`Subscribing to room: ${roomId}`);
    subscribedRooms.add(roomId);

    wsSend({
        msg: 'sub',
        id: `sub-${messageIdCounter++}`,
        name: 'stream-room-messages',
        params: [roomId, false]
    });
}

// ============================================
// UI HELPERS
// ============================================
function displayMessage(msg) {
    const container = document.getElementById('messages');

    // Skip if already displayed
    if (document.getElementById(`msg-${msg._id}`)) return;

    const div = document.createElement('div');
    div.className = 'message';
    div.id = `msg-${msg._id}`;

    // Check if own message
    if (msg.u?.username === username) {
        div.classList.add('own');
    }

    const time = new Date(msg.ts).toLocaleTimeString();
    const user = msg.u?.username || 'Unknown';
    let content = '';

    // Check for attachments (voice messages, files)
    if (msg.attachments && msg.attachments.length > 0) {
        msg.attachments.forEach(att => {
            if (att.audio_url) {
                content += `<audio controls src="${ROCKETCHAT_URL}${att.audio_url}"></audio>`;
            } else if (att.image_url) {
                content += `<img src="${ROCKETCHAT_URL}${att.image_url}" style="max-width:200px;border-radius:8px;">`;
            } else if (att.title_link) {
                content += `<a href="${ROCKETCHAT_URL}${att.title_link}" target="_blank">${escapeHtml(att.title || 'File')}</a>`;
            }
        });
    }

    // Text content
    if (msg.msg) {
        content += `<div class="text">${escapeHtml(msg.msg)}</div>`;
    }

    div.innerHTML = `
        <span class="user">${escapeHtml(user)}</span>
        <span class="time">${time}</span>
        ${content}
    `;

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// INIT
// ============================================
log('Rocket.Chat Client initialized');
log(`Server: ${ROCKETCHAT_URL}`);
