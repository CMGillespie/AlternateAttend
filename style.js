// Wordly Audio Recorder Script - COMPLETE for /present endpoint (with AudioWorklet)
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM elements - Login page ---
    const loginPage = document.getElementById('login-page');
    const appPage = document.getElementById('app-page');
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    const credentialsForm = document.getElementById('credentials-form');
    const loginStatus = document.getElementById('login-status');
    const sessionInput = document.getElementById('session-id');
    const passcodeKeyInput = document.getElementById('passcode');

    // --- DOM elements - App page ---
    const sessionIdDisplay = document.getElementById('session-id-display');
    const disconnectBtn = document.getElementById('disconnect-btn'); // Will become "End Session"
    const addDeviceBtn = document.getElementById('add-device-btn'); // Button to add a new recorder UI
    const recorderGrid = document.getElementById('player-grid'); // Container for recorder UIs
    const browserWarning = document.getElementById('browser-warning');
    const noDeviceSupportMessage = document.getElementById('no-device-support');
    const globalCollapseBtn = document.getElementById('global-collapse-btn');

    // --- DOM elements - Preset controls ---
    const presetNameInput = document.getElementById('preset-name');
    const savePresetBtn = document.getElementById('save-preset-btn');
    const presetSelect = document.getElementById('preset-select');
    const loadPresetBtn = document.getElementById('load-preset-btn');
    const deletePresetBtn = document.getElementById('delete-preset-btn');

    // --- Application state ---
    const state = {
        sessionId: null,
        accessKey: '',
        devices: [], // Audio INPUT devices
        recorders: [], // Holds state for each recorder instance
        presets: {},
        supportsMediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && navigator.mediaDevices.enumerateDevices),
        supportsAudioWorklet: !!(window.AudioContext && window.AudioContext.prototype.hasOwnProperty('audioWorklet')),
        allCollapsed: false,
        activeDeviceIds: new Set(), // Tracks device IDs currently being recorded from
        wordlyConnectionCode: '9005', // !!! REPLACE with your actual connection code from Wordly !!!
        isDisconnecting: false // Flag to prevent race conditions on disconnect
    };

    // --- Constants ---
    const WORDLY_WEBSOCKET_URL = 'wss://endpoint.wordly.ai/present';
    const TARGET_SAMPLE_RATE = 16000; // Target sample rate for Wordly
    const AUDIO_CHUNK_DURATION_MS = 100; // Send audio chunks roughly this often
    const WORKLET_PROCESSOR_NAME = 'pcm-processor';

    // Language mapping (Unchanged)
    const languageMap = {
        'af': 'Afrikaans', 'sq': 'Albanian', 'ar': 'Arabic', 'hy': 'Armenian', 'bn': 'Bengali',
        'bg': 'Bulgarian', 'zh-HK': 'Cantonese', 'ca': 'Catalan', 'zh-CN': 'Chinese (Simplified)',
        'zh-TW': 'Chinese (Traditional)', 'hr': 'Croatian', 'cs': 'Czech', 'da': 'Danish',
        'nl': 'Dutch', 'en': 'English (US)', 'en-AU': 'English (AU)', 'en-GB': 'English (UK)',
        'et': 'Estonian', 'fi': 'Finnish', 'fr': 'French (FR)', 'fr-CA': 'French (CA)',
        'ka': 'Georgian', 'de': 'German', 'el': 'Greek', 'gu': 'Gujarati', 'he': 'Hebrew',
        'hi': 'Hindi', 'hu': 'Hungarian', 'is': 'Icelandic', 'id': 'Indonesian', 'ga': 'Irish',
        'it': 'Italian', 'ja': 'Japanese', 'kn': 'Kannada', 'ko': 'Korean', 'lv': 'Latvian',
        'lt': 'Lithuanian', 'mk': 'Macedonian', 'ms': 'Malay', 'mt': 'Maltese', 'no': 'Norwegian',
        'fa': 'Persian', 'pl': 'Polish', 'pt': 'Portuguese (PT)', 'pt-BR': 'Portuguese (BR)',
        'ro': 'Romanian', 'ru': 'Russian', 'sr': 'Serbian', 'sk': 'Slovak', 'sl': 'Slovenian',
        'es': 'Spanish (ES)', 'es-MX': 'Spanish (MX)', 'sv': 'Swedish', 'tl': 'Tagalog',
        'th': 'Thai', 'tr': 'Turkish', 'uk': 'Ukrainian', 'vi': 'Vietnamese', 'cy': 'Welsh',
        'pa': 'Punjabi', 'sw': 'Swahili', 'ta': 'Tamil', 'ur': 'Urdu',
        'zh': 'Chinese' // Backward compatibility
    };

    // --- AudioWorklet Processor Code ---
    // This code runs in a separate thread to process audio efficiently.
    const pcmProcessorCode = `
      class PcmProcessor extends AudioWorkletProcessor {
        constructor(options) {
          super();
          this.targetSampleRate = options.processorOptions.targetSampleRate || 16000;
          this.bufferSize = options.processorOptions.bufferSize || 2048; // Adjust buffer size as needed
          this._buffer = new Float32Array(this.bufferSize);
          this._bufferPos = 0;
          // Simple resampling state (if needed - assumes input is Float32)
          this.resampleRatio = sampleRate / this.targetSampleRate; // sampleRate is global in worklet scope
          this.lastSample = 0; // For very basic linear interpolation if needed

          console.log(\`PCM Processor initialized. Global sampleRate: \${sampleRate}, Target: \${this.targetSampleRate}, Ratio: \${this.resampleRatio}\`);
        }

        // Simple linear interpolation for resampling (can be improved)
        resampleLinear(inputBuffer) {
            if (this.resampleRatio === 1) return inputBuffer; // No resampling needed

            const outputLength = Math.floor(inputBuffer.length / this.resampleRatio);
            const outputBuffer = new Float32Array(outputLength);
            let outputIndex = 0;

            for (let i = 0; i < inputBuffer.length; i++) {
                const targetInputPos = i / this.resampleRatio;
                const indexPrev = Math.floor(targetInputPos);
                const indexNext = Math.min(indexPrev + 1, inputBuffer.length - 1);
                const fraction = targetInputPos - indexPrev;

                const samplePrev = inputBuffer[indexPrev];
                const sampleNext = inputBuffer[indexNext];

                outputBuffer[outputIndex++] = samplePrev + (sampleNext - samplePrev) * fraction;
                if(outputIndex >= outputLength) break; // Avoid exceeding bounds
            }
            return outputBuffer;
        }


        process(inputs, outputs, parameters) {
          // Assuming mono input for simplicity
          const inputChannel = inputs[0][0];

          // If inputChannel is undefined, it means silence or the node is disconnected.
            if (!inputChannel) {
               // console.warn("PCM Processor: No input data received.");
                return true; // Keep processor alive
            }

          // Basic Resampling (if needed) - apply before buffering
           // NOTE: A more robust resampling library might be needed for high quality.
           // This simple linear interpolation might introduce artifacts.
           // let samplesToProcess = inputChannel;
           // if (this.resampleRatio !== 1) {
           //     samplesToProcess = this.resampleLinear(inputChannel);
           // }
           // For simplicity now, we'll ASSUME input is already 16kHz or close enough
           // Relying on getUserMedia constraints primarily.
            let samplesToProcess = inputChannel;

          // Buffer the incoming samples
          const availableSpace = this._buffer.length - this._bufferPos;
          const samplesToCopy = Math.min(availableSpace, samplesToProcess.length);
          this._buffer.set(samplesToProcess.subarray(0, samplesToCopy), this._bufferPos);
          this._bufferPos += samplesToCopy;

          // If buffer is full, process and send it
          if (this._bufferPos >= this._buffer.length) {
            const pcm16Buffer = this.convertToPCM16(this._buffer);
            this.port.postMessage(pcm16Buffer, [pcm16Buffer.buffer]); // Transfer buffer ownership

            // Handle remaining samples from input that didn't fit
            const remainingSamples = samplesToProcess.length - samplesToCopy;
            if (remainingSamples > 0) {
                this._buffer.set(samplesToProcess.subarray(samplesToCopy));
                this._bufferPos = remainingSamples;
            } else {
                 this._bufferPos = 0; // Reset buffer position
            }

          }

          // Keep the processor alive
          return true;
        }

        convertToPCM16(float32Buffer) {
          const pcm16 = new Int16Array(float32Buffer.length);
          for (let i = 0; i < float32Buffer.length; i++) {
            // Clamp values between -1.0 and 1.0 before converting
            const s = Math.max(-1, Math.min(1, float32Buffer[i]));
            // Convert to 16-bit integer (signed)
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          return pcm16;
        }
      }

      registerProcessor('${WORKLET_PROCESSOR_NAME}', PcmProcessor);
    `;

    // --- Global Variables ---
    let audioWorkletBlobUrl = null; // To store the URL for the worklet code

    // Initialize the application
    init();

    // --- Initialization Functions ---

    async function init() {
        setupTabs();
        setupLoginForms();
        setupPresetControls();
        setupAppControls();
        checkBrowserCompatibility();
        if (state.supportsAudioWorklet) {
           await createAudioWorklet();
        }
        loadPresetsFromStorage();
    }

    function checkBrowserCompatibility() {
        const isChromeBased = /Chrome/.test(navigator.userAgent) || /Edg/.test(navigator.userAgent);
        if (!isChromeBased) {
            browserWarning.textContent = 'Warning: This application is best tested on Chrome or Edge browsers.';
            browserWarning.style.display = 'block';
        } else {
            browserWarning.style.display = 'none';
        }
        let mediaError = false;
        if (!state.supportsMediaDevices) {
            noDeviceSupportMessage.textContent = 'Error: Browser does not support required media device APIs (getUserMedia/enumerateDevices).';
            mediaError = true;
        } else if (!state.supportsAudioWorklet) {
             noDeviceSupportMessage.textContent = 'Error: Browser does not support required AudioWorklet API.';
             mediaError = true;
        }

        if (mediaError) {
            noDeviceSupportMessage.style.display = 'block';
            addDeviceBtn.disabled = true; // Disable adding recorders if essential APIs missing
        } else {
            noDeviceSupportMessage.style.display = 'none';
        }
    }

    async function createAudioWorklet() {
        if (audioWorkletBlobUrl) return; // Already created

        try {
            const blob = new Blob([pcmProcessorCode], { type: 'application/javascript' });
            audioWorkletBlobUrl = URL.createObjectURL(blob);
            console.log("AudioWorklet Blob URL created:", audioWorkletBlobUrl);
            // We will add the module to specific AudioContexts when starting a recorder
        } catch (error) {
            console.error("Failed to create AudioWorklet Blob URL:", error);
            state.supportsAudioWorklet = false; // Mark as unsupported if blob fails
            checkBrowserCompatibility(); // Re-run check to show error message
        }
    }


    function setupTabs() {
        // Hide the weblink tab
        const linkTabButton = document.querySelector('.tab-button[data-tab="link-tab"]');
        const linkTabContent = document.getElementById('link-tab');
        if (linkTabButton) linkTabButton.style.display = 'none';
        if (linkTabContent) linkTabContent.style.display = 'none';

        // Make credentials tab active by default
        const credentialsTabButton = document.querySelector('.tab-button[data-tab="credentials-tab"]');
        const credentialsTabContent = document.getElementById('credentials-tab');
        if (credentialsTabButton && credentialsTabContent) {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            credentialsTabButton.classList.add('active');
            credentialsTabContent.classList.add('active');
        }
    }

    function setupLoginForms() {
        credentialsForm.addEventListener('submit', handleCredentialsForm);
    }

    function setupAppControls() {
        disconnectBtn.addEventListener('click', handleEndSessionClick); // Changed to End Session handler
        disconnectBtn.textContent = 'End Session'; // Update button text
        addDeviceBtn.addEventListener('click', () => addNewRecorder());
        globalCollapseBtn.addEventListener('click', toggleAllRecorders);
    }

    function setupPresetControls() {
        savePresetBtn.addEventListener('click', savePreset);
        loadPresetBtn.addEventListener('click', loadSelectedPreset);
        deletePresetBtn.addEventListener('click', deleteSelectedPreset);
    }

    // --- Login and Session Management ---

    function handleCredentialsForm(e) {
        e.preventDefault();
        let inputSessionId = sessionInput.value.trim();
        const inputAccessKey = passcodeKeyInput.value.trim();

        if (!isValidSessionId(inputSessionId)) {
            inputSessionId = formatSessionId(inputSessionId);
            if (!isValidSessionId(inputSessionId)) {
                showLoginError('Please enter a valid session ID in the format XXXX-0000');
                return;
            }
            sessionInput.value = inputSessionId;
        }

        processLogin(inputSessionId, inputAccessKey);
    }

    function isValidSessionId(sessionId) {
        return /^[A-Za-z0-9]{4}-\d{4}$/.test(sessionId);
    }

    function formatSessionId(input) {
        const cleaned = input.replace(/[^A-Za-z0-9]/g, '');
        return cleaned.length === 8 ? `${cleaned.substring(0, 4)}-${cleaned.substring(4)}` : input;
    }

    function showLoginError(message) {
        loginStatus.textContent = message;
        loginStatus.className = 'status-message error';
    }

    function showLoginSuccess(message) {
        loginStatus.textContent = message;
        loginStatus.className = 'status-message success';
    }

    async function processLogin(sessionId, accessKey) {
        if (!state.supportsMediaDevices || !state.supportsAudioWorklet) {
             showLoginError("Cannot proceed: Browser missing required features.");
             return;
        }
        showLoginSuccess('Fetching audio input devices...');
        try {
            await initializeAudioDevices();

            state.sessionId = sessionId;
            state.accessKey = accessKey;

            showLoginSuccess('Session details stored. Ready to add recorders.');

            loginPage.style.display = 'none';
            appPage.style.display = 'flex';
            sessionIdDisplay.textContent = `Session: ${sessionId}`;

            // Add the first recorder automatically and attempt to start it
            if (state.recorders.length === 0) {
                 const firstRecorder = addNewRecorder();
                 if (firstRecorder) {
                     console.log("Attempting to auto-start the first recorder.");
                     // Find the start button and click it programmatically
                     const startButton = firstRecorder.element.querySelector('.start-stop-btn');
                     if(startButton) {
                        // Use a small delay to ensure the element is fully ready
                        setTimeout(() => startButton.click(), 100);
                     }
                 }
            }

            showNotification(`Entered Session ${sessionId}. Add recorders or use the auto-added one.`, 'info');

        } catch (err) {
            showLoginError(`Failed to initialize audio devices: ${err.message}. Please grant microphone permission.`);
        }
    }

    async function initializeAudioDevices() {
        if (!state.supportsMediaDevices) throw new Error("Media device APIs not supported.");

        try {
            console.log("Requesting microphone permission...");
            // Try requesting the target sample rate directly
            const constraints = {
                audio: {
                    sampleRate: { ideal: TARGET_SAMPLE_RATE },
                    channelCount: 1 // Request mono
                },
                video: false
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            const settings = stream.getAudioTracks()[0].getSettings();
            console.log("Microphone permission granted. Actual settings:", settings);
            // Store the actual sample rate if needed for resampling later
            // state.microphoneSampleRate = settings.sampleRate || TARGET_SAMPLE_RATE;
            stream.getTracks().forEach(track => track.stop());

            console.log("Enumerating devices...");
            const devices = await navigator.mediaDevices.enumerateDevices();
            state.devices = devices.filter(device => device.kind === 'audioinput');

            if (state.devices.length === 0) {
                console.warn("No audio input devices found.");
                showNotification("No audio input devices found. Cannot record.", "error");
                addDeviceBtn.disabled = true;
            } else {
                console.log(`Found ${state.devices.length} audio input devices.`);
                addDeviceBtn.disabled = false;
                // Update existing recorders' dropdowns (e.g., if permission granted late)
                state.recorders.forEach(recorder => {
                    const deviceSelect = recorder.element.querySelector('.device-select');
                    if (deviceSelect) populateDeviceSelect(deviceSelect, recorder.deviceId);
                });
            }
        } catch (error) {
            console.error('Error accessing audio devices:', error);
            const errorMessage = error.name === 'NotAllowedError' ? 'Microphone permission denied.' : `Could not access audio devices (${error.name}).`;
            throw new Error(errorMessage);
        }
    }

    // --- Global Disconnect / End Session ---
    function handleEndSessionClick() {
         if (!state.sessionId) return; // No session active
         if (confirm(`Are you sure you want to END this session (${state.sessionId}) for ALL participants?`)) {
             endSessionForAll();
         }
    }

    function endSessionForAll() {
         if (state.isDisconnecting) return; // Prevent multiple calls
         state.isDisconnecting = true;
         console.log("Attempting to end session for all...");

         let disconnectMessageSent = false;
         // Find the first connected recorder to send the 'disconnect(end:true)' message
         const connectedRecorder = state.recorders.find(r => r.websocket && r.websocket.readyState === WebSocket.OPEN);

         if (connectedRecorder) {
             try {
                 const disconnectRequest = { type: 'disconnect', end: true };
                 connectedRecorder.websocket.send(JSON.stringify(disconnectRequest));
                 disconnectMessageSent = true;
                 console.log(`Sent 'disconnect(end:true)' via recorder ${connectedRecorder.id}`);
             } catch (error) {
                 console.error("Error sending disconnect(end:true) message:", error);
             }
         } else {
             console.warn("No connected recorder found to send the end session message.");
             // Proceed with local cleanup anyway
         }

         // Regardless of whether the message was sent, clean up locally.
         // Add a small delay to allow the message to potentially be sent/processed.
         setTimeout(() => {
             disconnectAndReset(true); // Pass flag indicating it was an intended session end
             state.isDisconnecting = false;
         }, 500); // 500ms delay
    }

    // Central cleanup function
    function disconnectAndReset(isSessionEnd = false) {
        console.log(`Disconnecting and resetting UI. Was session end: ${isSessionEnd}`);
        state.isDisconnecting = true; // Set flag during cleanup

        // Stop capture and close sockets for all recorders
        state.recorders.forEach(recorder => {
            stopAudioCapture(recorder); // Stop worklet/stream first
            if (recorder.websocket && recorder.websocket.readyState !== WebSocket.CLOSED) {
                 try {
                     // Use code 1000 (Normal Closure) if session end initiated by user,
                     // or maybe 1001 (Going Away) if just local reset.
                     recorder.websocket.close(isSessionEnd ? 1000 : 1001, isSessionEnd ? "Session ended by user" : "Local reset");
                 } catch (e) { console.error(`Error closing websocket for recorder ${recorder.id}:`, e); }
            }
            recorder.websocket = null; // Clear reference
        });

        recorderGrid.innerHTML = '';
        state.recorders = [];
        state.activeDeviceIds.clear();

        // Reset login form state? Maybe not necessary if just disconnecting
        // credentialsForm.reset();

        appPage.style.display = 'none';
        loginPage.style.display = 'flex';

        const previousSessionId = state.sessionId; // Keep track for notification
        state.sessionId = null;
        state.accessKey = '';
        loginStatus.textContent = '';
        loginStatus.className = 'status-message';
        state.isDisconnecting = false; // Clear flag after cleanup

        if (previousSessionId) {
             showNotification(isSessionEnd ? `Session ${previousSessionId} ended.` : `Disconnected from session ${previousSessionId}.`, 'info');
        }
    }


    // --- Recorder Management ---

    function addNewRecorder(config = {}) {
        if (!state.sessionId) { showNotification('Cannot add recorder, session not active.', 'error'); return null; }
        if (state.devices.length === 0) { showNotification('Cannot add recorder, no audio input devices found.', 'error'); return null; }
        if (!state.supportsAudioWorklet || !audioWorkletBlobUrl) { showNotification('Cannot add recorder, AudioWorklet not ready.', 'error'); return null; }

        const recorderId = `recorder-${Date.now()}`;

        const defaultConfig = {
            language: 'en',
            deviceId: state.devices[0]?.deviceId || '',
            speakerName: `Speaker ${state.recorders.length + 1}`,
            collapsed: false
        };

        const recorderConfig = { ...defaultConfig, ...config };

        if (recorderConfig.deviceId && !state.devices.find(d => d.deviceId === recorderConfig.deviceId)) {
            console.warn(`Device ID ${recorderConfig.deviceId} not found, using first available device.`);
            recorderConfig.deviceId = state.devices[0]?.deviceId || '';
        }

        const recorderEl = document.createElement('div');
        recorderEl.className = 'player'; // Reuse player CSS
        recorderEl.id = recorderId;

        const languageName = getLanguageName(recorderConfig.language);

        recorderEl.innerHTML = `
          <div class="player-header">
            <div class="player-title">
              <span class="player-status-light disconnected" title="Status"></span>
              <input type="text" class="speaker-name-input" value="${recorderConfig.speakerName}" placeholder="Speaker Name..." title="Speaker Name">
              <span class="player-language-indicator" title="Selected Language">${languageName}</span>
            </div>
            <div class="player-controls">
               <button class="player-btn collapse-btn" data-action="toggle-collapse" title="Collapse/Expand">Collapse</button>
               <button class="player-btn leave-btn" data-action="leave" title="Leave Session (this recorder only)">Leave</button>
            </div>
          </div>
          <div class="player-settings">
            <div class="setting-group">
              <span class="setting-label">Language:</span>
              <select class="setting-select language-select" title="Select language being spoken"></select>
            </div>
            <div class="setting-group">
              <span class="setting-label">Input Device:</span>
              <select class="setting-select device-select" title="Select audio input device"></select>
            </div>
            <div class="setting-group">
                 <button class="start-stop-btn" data-action="toggle-recording" title="Start/Stop sending audio">Start</button>
            </div>
          </div>
          <div class="player-content ${recorderConfig.collapsed ? 'collapsed' : ''}">
             <div class="recorder-status-log" style="font-size: 12px; padding: 5px; height: 50px; overflow-y: auto; background: #f0f0f0; border: 1px solid #eee; border-radius: 3px; margin-bottom: 5px;"></div>
             <div class="player-status disconnected">Idle</div>
          </div>
        `;

        recorderGrid.appendChild(recorderEl);

        const languageSelect = recorderEl.querySelector('.language-select');
        populateLanguageSelect(languageSelect, recorderConfig.language);

        const deviceSelect = recorderEl.querySelector('.device-select');
        populateDeviceSelect(deviceSelect, recorderConfig.deviceId);

        const recorderInstance = {
            id: recorderId,
            element: recorderEl,
            language: recorderConfig.language,
            deviceId: recorderConfig.deviceId,
            speakerName: recorderConfig.speakerName,
            collapsed: recorderConfig.collapsed,
            websocket: null,
            status: 'disconnected', // WS connection status
            isStarted: false, // Recording active flag
            audioContext: null,
            mediaStreamSource: null,
            audioWorkletNode: null,
            audioStream: null,
            reconnectAttempts: 0
        };

        state.recorders.push(recorderInstance);
        addRecorderEventListeners(recorderEl, recorderInstance);

        console.log(`Added recorder ${recorderId} UI for language ${languageName}`);
        addStatusLog(recorderInstance, "Recorder added. Select settings and click Start.");
        return recorderInstance;
    }

    function removeRecorder(recorder, sendDisconnect = true) {
        if (!recorder) return;
        console.log(`Removing recorder ${recorder.id}. Send Disconnect: ${sendDisconnect}`);

        stopAudioCapture(recorder); // Stop audio capture first

        if (sendDisconnect && recorder.websocket && recorder.websocket.readyState === WebSocket.OPEN) {
            try {
                const disconnectRequest = { type: 'disconnect', end: false }; // Leave, don't end session
                recorder.websocket.send(JSON.stringify(disconnectRequest));
                console.log(`Sent disconnect(end:false) for recorder ${recorder.id}`);
            } catch (error) {
                console.error(`Error sending disconnect(end:false) for recorder ${recorder.id}:`, error);
            }
        }

        // Close WebSocket after potentially sending disconnect
        if (recorder.websocket && recorder.websocket.readyState !== WebSocket.CLOSED) {
             try {
                 recorder.websocket.close(1000, "Recorder removed by user");
             } catch (e) { console.error(`Error closing websocket for recorder ${recorder.id}:`, e); }
        }
        recorder.websocket = null;

        // Remove from active devices if it was active
        if (state.activeDeviceIds.has(recorder.deviceId)) {
             state.activeDeviceIds.delete(recorder.deviceId);
             // Re-enable start buttons for other recorders using this device
             updateStartButtonStates(recorder.deviceId);
        }

        recorder.element.remove();

        const index = state.recorders.findIndex(r => r.id === recorder.id);
        if (index !== -1) {
            state.recorders.splice(index, 1);
        }
        showNotification(`Recorder "${recorder.speakerName}" removed`, 'success');
         // Update button states in case this was the last recorder using a device
         updateAllStartButtonStates();
    }

    function getRecorderById(recorderId) {
        return state.recorders.find(recorder => recorder.id === recorderId) || null;
    }

    // --- WebSocket Handling ---

    function connectRecorderWebSocket(recorder) {
        if (state.isDisconnecting) return; // Don't connect if globally disconnecting
        if (!state.sessionId) {
            updateRecorderStatus(recorder, 'error', 'Missing Session ID');
            return;
        }
        if (recorder.websocket && recorder.websocket.readyState === WebSocket.OPEN) {
            console.log(`WebSocket for recorder ${recorder.id} already open.`);
            // If already open, maybe just proceed to send 'start'?
            // For now, assume this is called when needing a fresh connection.
            return;
        }
        if (recorder.websocket && recorder.websocket.readyState === WebSocket.CONNECTING) {
             console.log(`WebSocket for recorder ${recorder.id} already connecting.`);
             return;
        }


        updateRecorderStatus(recorder, 'connecting', 'WebSocket Connecting...');
        addStatusLog(recorder, "Connecting WebSocket...");

        try {
            recorder.websocket = new WebSocket(WORDLY_WEBSOCKET_URL);
            recorder.websocket.binaryType = 'arraybuffer'; // Expecting to send binary audio

            recorder.websocket.onopen = () => handleWebSocketOpen(recorder);
            recorder.websocket.onmessage = (event) => handleWebSocketMessage(recorder, event);
            recorder.websocket.onclose = (event) => handleWebSocketClose(recorder, event);
            recorder.websocket.onerror = (error) => handleWebSocketError(recorder, error);

        } catch (error) {
            console.error(`Error creating WebSocket for recorder ${recorder.id}:`, error);
            updateRecorderStatus(recorder, 'error', 'WebSocket Connection error');
            addStatusLog(recorder, `WebSocket error: ${error.message}`, true);
            recorder.websocket = null; // Ensure it's null on creation error
            handleRecorderStop(recorder); // Ensure UI resets if connection fails instantly
        }
    }

    function handleWebSocketOpen(recorder) {
        if (!recorder || !recorder.websocket) return; // Check if recorder still exists/valid
        console.log(`WebSocket connection established for recorder ${recorder.id}`);
        updateRecorderStatus(recorder, 'authenticating', 'Authenticating...'); // Custom status?
        addStatusLog(recorder, "WebSocket open. Sending connect request...");
        recorder.reconnectAttempts = 0; // Reset reconnect attempts on successful open

        const connectRequest = {
            type: 'connect',
            presentationCode: state.sessionId,
            accessKey: state.accessKey,
            languageCode: recorder.language, // Initial language
            name: recorder.speakerName,
            speakerId: recorder.id, // Use unique recorder ID as speakerId
            connectionCode: state.wordlyConnectionCode
            // context: recorder.context || null // Add context for reconnect later if needed
        };

        try {
            recorder.websocket.send(JSON.stringify(connectRequest));
        } catch (error) {
            console.error(`Error sending connect request for recorder ${recorder.id}:`, error);
            updateRecorderStatus(recorder, 'error', 'WS Send error');
            addStatusLog(recorder, `Error sending connect request: ${error.message}`, true);
            handleRecorderStop(recorder); // Reset state if send fails
        }
    }

    function handleWebSocketMessage(recorder, event) {
        if (!recorder || !recorder.websocket) return; // Check validity

        try {
            const message = JSON.parse(event.data);
            // console.log(`Recorder ${recorder.id} received message:`, message); // DEBUG

            switch (message.type) {
                case 'status':
                    handlePresentStatusMessage(recorder, message);
                    break;
                case 'result':
                    handleResultMessage(recorder, message);
                    break;
                case 'end':
                    handleEndMessage(recorder, message);
                    break;
                case 'error':
                    handleErrorMessage(recorder, message);
                    break;
                case 'echo':
                    console.log(`Echo received for recorder ${recorder.id}`);
                    // Could update a 'last seen' timestamp
                    break;
                default:
                    console.warn(`Unhandled message type: ${message.type} for recorder ${recorder.id}`);
            }
        } catch (error) {
            console.error(`Error processing message for recorder ${recorder.id}:`, error, event.data);
            addStatusLog(recorder, `Error processing message: ${error.message}`, true);
        }
    }

    function handleWebSocketClose(recorder, event) {
        if (!recorder) return;
        console.log(`WebSocket closed for recorder ${recorder.id}. Code: ${event.code}, Reason: ${event.reason}, Was Clean: ${event.wasClean}`);

        const wasConnected = recorder.status !== 'disconnected' && recorder.status !== 'error';
        recorder.websocket = null; // Clear WS reference

        // Determine status based on close code
        let status = 'disconnected';
        let message = `WebSocket Closed (Code: ${event.code})`;
        if (event.code === 1000 || event.code === 1001 || event.wasClean) {
            status = 'disconnected'; // Normal closure or going away
            message = event.reason || "Disconnected";
        } else {
            status = 'error'; // Abnormal closure
            message = `Connection Lost (Code: ${event.code})`;
        }
        updateRecorderStatus(recorder, status, message);
        addStatusLog(recorder, message, status === 'error');

        // Important: Stop audio capture and update button states/active devices
        // Call handleRecorderStop to reset UI and state consistently
        handleRecorderStop(recorder);

        // Optional: Simple automatic reconnect logic for unexpected closures
        // if (!event.wasClean && status === 'error' && recorder.reconnectAttempts < 3 && !state.isDisconnecting) {
        //     recorder.reconnectAttempts++;
        //     const delay = Math.pow(2, recorder.reconnectAttempts) * 1000; // Exponential backoff
        //     console.log(`Attempting reconnect ${recorder.reconnectAttempts} for recorder ${recorder.id} in ${delay}ms...`);
        //     addStatusLog(recorder, `Connection lost. Reconnecting (attempt ${recorder.reconnectAttempts})...`);
        //     setTimeout(() => {
        //          // Check if the recorder still exists in the state before reconnecting
        //         if (state.recorders.find(r => r.id === recorder.id)) {
        //             connectRecorderWebSocket(recorder); // Attempt reconnect
        //         }
        //     }, delay);
        // } else if (!event.wasClean && status === 'error') {
        //      addStatusLog(recorder, "Connection failed after multiple attempts.", true);
        // }
    }

    function handleWebSocketError(recorder, error) {
        if (!recorder) return;
        console.error(`WebSocket error for recorder ${recorder.id}:`, error);
        updateRecorderStatus(recorder, 'error', 'WebSocket Connection Error');
        addStatusLog(recorder, "WebSocket error occurred.", true);
        // WS potentially remains open but unusable, or might close triggering onclose.
        // It's safest to assume the connection is dead.
        if (recorder.websocket && recorder.websocket.readyState !== WebSocket.CLOSED) {
            recorder.websocket.close(1011, "WebSocket error"); // Internal error
        }
        recorder.websocket = null;
        handleRecorderStop(recorder); // Reset state
    }

    // --- Message Handling Logic ---

    function handlePresentStatusMessage(recorder, message) {
        console.log(`Recorder ${recorder.id} Status Message:`, message);
        if (message.success) {
            updateRecorderStatus(recorder, 'connected', 'Connected (Ready)'); // Ready, but not started yet
            addStatusLog(recorder, `Authentication successful. Ready to start recording.`);
             // If the intention was to start immediately after connect (first recorder/reconnect), trigger start now
             if (recorder.element.querySelector('.start-stop-btn').textContent === 'Stop') { // Check if start was intended
                 // This assumes the button text reflects the desired state
                 sendStartRequest(recorder);
             }
        } else {
            const errMsg = message.message || 'Connection/Authentication failed';
            updateRecorderStatus(recorder, 'error', errMsg);
            addStatusLog(recorder, `Connection Error: ${errMsg}`, true);
            // Close the WebSocket cleanly on auth failure etc.
            if (recorder.websocket && recorder.websocket.readyState !== WebSocket.CLOSED) {
                 recorder.websocket.close(1008, "Status indicates failure"); // Policy Violation
            }
            handleRecorderStop(recorder); // Reset UI/state
        }
        // Handle other status info like reservedUntil, allowTranscript if needed
        // if (message.reservedUntil) { ... }
    }

    function handleResultMessage(recorder, message) {
        // This message contains the transcription of the audio sent FROM this recorder.
        // console.log(`Recorder ${recorder.id} Result:`, message); // DEBUG
        if (message.text) {
            // Optional: Display the result in the log or another element
            addStatusLog(recorder, `Result (${message.final ? 'Final' : 'Partial'}): "${message.text}"`);
        }
        // The 'context' field might be useful for reconnecting later, store it if needed:
        // if (message.context) recorder.context = message.context;
    }

    function handleEndMessage(recorder, message) {
         // This means the session was ended by *someone* (could be this client via endSessionForAll, or another presenter)
         console.log(`Recorder ${recorder.id} received END message:`, message);
         const endReason = message.message || `Session ended (Code: ${message.code || 'N/A'})`;
         updateRecorderStatus(recorder, 'ended', endReason);
         addStatusLog(recorder, `Session Ended: ${endReason}`, message.code !== 0 && message.code !== undefined); // Mark as error if code indicates issue

         handleRecorderStop(recorder); // Stop local processes

         // Close WebSocket if it's still open
         if (recorder.websocket && recorder.websocket.readyState !== WebSocket.CLOSED) {
             recorder.websocket.close(1000, "Session ended remotely");
         }
         recorder.websocket = null;

         // Optionally inform user globally if not initiated locally
         if (!state.isDisconnecting) { // Check if this end was unexpected
              showNotification(`Session Ended: ${endReason}`, 'info');
              // Consider resetting the whole UI if session ends globally
              // disconnectAndReset(true); // Might be too disruptive if user has other sessions?
         }
    }

    function handleErrorMessage(recorder, message) {
        // Generic error from Wordly during the session
        console.error(`Recorder ${recorder.id} received ERROR message:`, message);
        const errMsg = message.message || 'Unknown server error';
        updateRecorderStatus(recorder, 'error', errMsg);
        addStatusLog(recorder, `Server Error: ${errMsg}`, true);
        // Decide if the error is fatal for this recorder
        // Maybe stop recording but keep WebSocket open? Or close it?
        // For now, just log it.
    }

    // --- Audio Capture (AudioWorklet) ---

    async function startAudioCapture(recorder) {
        if (!recorder || recorder.audioContext) {
            console.warn(`Recorder ${recorder.id}: Already capturing or invalid recorder state.`);
            return false; // Indicate failure
        }
        if (!state.supportsAudioWorklet || !audioWorkletBlobUrl) {
             addStatusLog(recorder, "AudioWorklet not supported or not loaded.", true);
             updateRecorderStatus(recorder, 'error', 'AudioWorklet Error');
             return false;
        }

        addStatusLog(recorder, `Starting audio capture for device: ${getDeviceName(recorder.deviceId)}`);

        try {
            // 1. Get MediaStream
             const constraints = {
                 audio: {
                     deviceId: recorder.deviceId ? { exact: recorder.deviceId } : undefined,
                     sampleRate: { ideal: TARGET_SAMPLE_RATE }, // Request 16kHz
                     channelCount: 1, // Request mono
                     echoCancellation: true, // Enable typical audio processing
                     noiseSuppression: true,
                     autoGainControl: true
                 },
                 video: false
             };
            recorder.audioStream = await navigator.mediaDevices.getUserMedia(constraints);
            const audioTrack = recorder.audioStream.getAudioTracks()[0];
            const actualSettings = audioTrack.getSettings();
            console.log(`Recorder ${recorder.id}: Acquired audio stream. Actual settings:`, actualSettings);
            addStatusLog(recorder, `Using: ${actualSettings.deviceId ? getDeviceName(actualSettings.deviceId) : 'Default'} @ ${actualSettings.sampleRate || 'N/A'}Hz`);

            // Warn if sample rate is not ideal
            if (actualSettings.sampleRate && actualSettings.sampleRate !== TARGET_SAMPLE_RATE) {
                 console.warn(`Recorder ${recorder.id}: Sample rate mismatch. Requested ${TARGET_SAMPLE_RATE}, got ${actualSettings.sampleRate}. AudioWorklet will attempt processing, quality may vary.`);
                 addStatusLog(recorder, `Warning: Sample rate ${actualSettings.sampleRate}Hz differs from target ${TARGET_SAMPLE_RATE}Hz.`, true);
            }


            // 2. Create AudioContext and Add Module
            // Use the actual sample rate from the track if available, otherwise hope for the best
            const contextSampleRate = actualSettings.sampleRate || TARGET_SAMPLE_RATE; // Be careful with AudioContext rate
            recorder.audioContext = new AudioContext({ sampleRate: contextSampleRate }); // Try matching context rate to source

            // Check if module needs adding to this specific context
            // This check might be overly simplistic; robust check involves iterating context.audioWorklet._processors
             try {
                 await recorder.audioContext.audioWorklet.addModule(audioWorkletBlobUrl);
                 console.log(`Recorder ${recorder.id}: AudioWorklet module added to context.`);
             } catch (moduleError) {
                 // Handle cases where the module might already be added (though addModule should handle this)
                 // Or if loading fails for other reasons
                 console.error(`Recorder ${recorder.id}: Error adding AudioWorklet module:`, moduleError);
                 // Check if it's the specific "already added" error if possible, otherwise treat as failure
                 if (!`${moduleError}`.includes('already added')) { // Simple string check, might be fragile
                      throw moduleError; // Re-throw if it's not the expected "already added" error
                 }
                  console.log(`Recorder ${recorder.id}: AudioWorklet module likely already present.`);
             }


            // 3. Create Nodes
            recorder.mediaStreamSource = recorder.audioContext.createMediaStreamSource(recorder.audioStream);
            const workletOptions = {
                 processorOptions: {
                      targetSampleRate: TARGET_SAMPLE_RATE
                      // bufferSize: 4096 // Optional: Adjust buffer size if needed
                 }
             };
            recorder.audioWorkletNode = new AudioWorkletNode(recorder.audioContext, WORKLET_PROCESSOR_NAME, workletOptions);

            // 4. Setup Message Handling (Worklet -> Main Thread)
            recorder.audioWorkletNode.port.onmessage = (event) => {
                if (recorder.websocket && recorder.websocket.readyState === WebSocket.OPEN && recorder.isStarted) {
                     // Send the Int16Array buffer directly
                     try {
                         recorder.websocket.send(event.data.buffer);
                     } catch (sendError) {
                          console.error(`Recorder ${recorder.id}: Error sending audio data:`, sendError);
                          // Handle potential WebSocket closure or buffer issues
                          addStatusLog(recorder, "Error sending audio data.", true);
                          handleRecorderStop(recorder); // Stop on send error?
                     }
                }
            };
             recorder.audioWorkletNode.port.onmessageerror = (error) => {
                 console.error(`Recorder ${recorder.id}: Error receiving message from worklet:`, error);
                 addStatusLog(recorder, "Audio processing error (message).", true);
                 handleRecorderStop(recorder);
             };


            // 5. Connect Nodes: Source -> Worklet
            recorder.mediaStreamSource.connect(recorder.audioWorkletNode);
            // We don't need to connect the worklet to the destination unless we want local playback for monitoring
            // recorder.audioWorkletNode.connect(recorder.audioContext.destination);


            console.log(`Recorder ${recorder.id}: Audio capture setup complete.`);
            addStatusLog(recorder, "Audio capture started.");
            return true; // Indicate success

        } catch (error) {
            console.error(`Recorder ${recorder.id}: Error starting audio capture:`, error);
            addStatusLog(recorder, `Error starting audio: ${error.message}`, true);
            updateRecorderStatus(recorder, 'error', 'Audio Capture Error');
            stopAudioCapture(recorder); // Clean up any partial setup
            return false; // Indicate failure
        }
    }

    function stopAudioCapture(recorder) {
        if (!recorder) return;
        // console.log(`Recorder ${recorder.id}: Stopping audio capture.`); // DEBUG

        // 1. Disconnect nodes
        if (recorder.mediaStreamSource && recorder.audioWorkletNode) {
            try {
                recorder.mediaStreamSource.disconnect(recorder.audioWorkletNode);
            } catch (e) { console.warn("Error disconnecting media stream source:", e); }
        }
         // If worklet was connected to destination, disconnect that too
         // if (recorder.audioWorkletNode && recorder.audioContext) {
         //     try { recorder.audioWorkletNode.disconnect(recorder.audioContext.destination); } catch (e) {}
         // }


        // 2. Close AudioContext
        if (recorder.audioContext && recorder.audioContext.state !== 'closed') {
            recorder.audioContext.close()
                .then(() => console.log(`Recorder ${recorder.id}: AudioContext closed.`))
                .catch(e => console.warn(`Recorder ${recorder.id}: Error closing AudioContext:`, e));
        }

        // 3. Stop MediaStream Tracks
        if (recorder.audioStream) {
            recorder.audioStream.getTracks().forEach(track => track.stop());
            console.log(`Recorder ${recorder.id}: MediaStream tracks stopped.`);
        }

        // 4. Clear references
        recorder.audioContext = null;
        recorder.mediaStreamSource = null;
        recorder.audioWorkletNode = null;
        recorder.audioStream = null;

         // Don't reset recorder.isStarted here, handleRecorderStop does that
         // addStatusLog(recorder, "Audio capture stopped."); // Logged in handleRecorderStop
    }

    // --- Recorder Control Logic ---

    async function handleRecorderStart(recorder) {
        if (!recorder || recorder.isStarted) return;

         // Check device constraint
        if (state.activeDeviceIds.has(recorder.deviceId)) {
             const conflictRecorder = state.recorders.find(r => r.deviceId === recorder.deviceId && r.isStarted);
             const message = `Device "${getDeviceName(recorder.deviceId)}" is already in use by "${conflictRecorder?.speakerName || 'another recorder'}". Stop that one first.`;
             showNotification(message, 'error');
             addStatusLog(recorder, message, true);
             return;
        }

        // Update UI immediately for responsiveness
        const startStopBtn = recorder.element.querySelector('.start-stop-btn');
        startStopBtn.textContent = 'Starting...';
        startStopBtn.disabled = true;
        recorder.element.querySelector('.language-select').disabled = true;
        recorder.element.querySelector('.device-select').disabled = true;
        recorder.element.querySelector('.speaker-name-input').disabled = true;

        // Mark device as active *optimistically* to prevent immediate race conditions
        state.activeDeviceIds.add(recorder.deviceId);
        updateStartButtonStates(recorder.deviceId); // Disable other buttons for this device

        // 1. Connect WebSocket (if not already connected)
        if (!recorder.websocket || recorder.websocket.readyState === WebSocket.CLOSED) {
            connectRecorderWebSocket(recorder);
            // Need to wait for 'status' success message before sending 'start'
            // handlePresentStatusMessage will trigger sendStartRequest if appropriate
        } else if (recorder.websocket.readyState === WebSocket.OPEN) {
            // WebSocket already open, proceed to send 'start'
             sendStartRequest(recorder);
        } else if (recorder.websocket.readyState === WebSocket.CONNECTING) {
             // Wait for connection to complete, onopen/status handler will trigger start
             console.log(`Recorder ${recorder.id}: Waiting for existing WebSocket connection to complete...`);
             addStatusLog(recorder, "Waiting for WebSocket connection...");
        }
    }

    function sendStartRequest(recorder) {
        if (!recorder || !recorder.websocket || recorder.websocket.readyState !== WebSocket.OPEN || recorder.isStarted) {
            console.warn(`Recorder ${recorder.id}: Cannot send start request. WS Ready: ${recorder.websocket?.readyState}, isStarted: ${recorder.isStarted}`);
             // If start request fails when intended, reset UI state
             if (!recorder.isStarted) {
                 handleRecorderStop(recorder); // Make sure button resets etc.
             }
            return;
        }

        addStatusLog(recorder, "Sending start request...");
        const startRequest = {
            type: 'start',
            languageCode: recorder.language,
            sampleRate: TARGET_SAMPLE_RATE // Inform server of the rate we aim to send
            // model: 'premium' // Optional: specific model
            // dynamicLanguageSelection: { enabled: false } // Optional
        };

        try {
            recorder.websocket.send(JSON.stringify(startRequest));
            // Now attempt to start audio capture
            startAudioCapture(recorder).then(success => {
                 if (success) {
                     // Audio capture started successfully AFTER sending 'start'
                     recorder.isStarted = true;
                     updateRecorderStatus(recorder, 'connected', 'Recording Active'); // Green light + status text
                     addStatusLog(recorder, "Recording started successfully.");
                     // Update button state fully *after* successful start
                     const startStopBtn = recorder.element.querySelector('.start-stop-btn');
                     startStopBtn.textContent = 'Stop';
                     startStopBtn.disabled = false;
                 } else {
                     // Audio capture failed, need to revert state and maybe send 'stop'
                     addStatusLog(recorder, "Audio capture failed after sending start request.", true);
                     sendStopRequest(recorder); // Tell server we failed to start sending audio
                     handleRecorderStop(recorder); // Reset UI and state
                 }
             });
        } catch (error) {
            console.error(`Recorder ${recorder.id}: Error sending start request:`, error);
            addStatusLog(recorder, `Error sending start request: ${error.message}`, true);
             handleRecorderStop(recorder); // Reset UI and state on send error
        }
    }

    function handleRecorderStop(recorder) {
         if (!recorder) return;
         console.log(`Recorder ${recorder.id}: Handling stop action.`);

        // Send 'stop' message to server IF websocket is open
         if (recorder.isStarted && recorder.websocket && recorder.websocket.readyState === WebSocket.OPEN) {
             sendStopRequest(recorder);
         }

        // Stop local audio capture regardless of WS state
        stopAudioCapture(recorder);

        // Update state AFTER stopping capture and sending message
        recorder.isStarted = false;

         // Update active device list
         if (state.activeDeviceIds.has(recorder.deviceId)) {
             state.activeDeviceIds.delete(recorder.deviceId);
             // Re-enable start buttons for other recorders using this device
             updateStartButtonStates(recorder.deviceId);
         }

        // Update UI
        const startStopBtn = recorder.element.querySelector('.start-stop-btn');
        if (startStopBtn) {
             startStopBtn.textContent = 'Start';
             startStopBtn.disabled = false; // Re-enable button
        }
         recorder.element.querySelector('.language-select').disabled = false;
         recorder.element.querySelector('.device-select').disabled = false;
         recorder.element.querySelector('.speaker-name-input').disabled = false;

         // Update status light and text based on WebSocket connection status
         updateRecorderStatus(recorder, recorder.status, recorder.status === 'connected' ? 'Connected (Ready)' : 'Disconnected');
         addStatusLog(recorder, "Recording stopped.");
    }

    function sendStopRequest(recorder) {
         if (!recorder || !recorder.websocket || recorder.websocket.readyState !== WebSocket.OPEN) {
             console.warn(`Recorder ${recorder.id}: Cannot send stop request, WebSocket not open.`);
             return;
         }
         console.log(`Recorder ${recorder.id}: Sending stop request.`);
         try {
             const stopRequest = { type: 'stop' };
             recorder.websocket.send(JSON.stringify(stopRequest));
         } catch (error) {
             console.error(`Recorder ${recorder.id}: Error sending stop request:`, error);
             addStatusLog(recorder, `Error sending stop request: ${error.message}`, true);
             // Continue with local stop procedure anyway
         }
    }

    function handleRecorderLeave(recorder) {
         if (!recorder) return;
         console.log(`Recorder ${recorder.id}: Handling leave action.`);
         if (confirm(`Are you sure you want to leave the session with "${recorder.speakerName}"? This recorder will be removed.`)) {
             removeRecorder(recorder, true); // Call remove, which handles disconnect(end:false)
         }
    }


    // --- UI Updates and Event Handling ---

    function updateRecorderStatus(recorder, status, message) {
        if (!recorder || !recorder.element) return; // Ensure recorder and element exist
        recorder.status = status; // Update internal status

        const statusLight = recorder.element.querySelector('.player-status-light');
        const statusEl = recorder.element.querySelector('.player-status');

        // Determine light class based on WS status and recording state (isStarted)
        let lightClass = 'disconnected'; // Default Red
        if (status === 'error') {
             lightClass = 'error'; // Red
        } else if (status === 'connecting' || status === 'authenticating') {
             lightClass = 'connecting'; // Orange pulse
        } else if (status === 'connected') {
            lightClass = recorder.isStarted ? 'connected' : 'disconnected'; // Green if started, Red if connected but idle
        } else if (status === 'ended') {
             lightClass = 'ended'; // Grey
        }

        if (statusLight) statusLight.className = `player-status-light ${lightClass}`;

        // Determine status text
        let statusText = message || status.charAt(0).toUpperCase() + status.slice(1);
        if (status === 'connected') {
             statusText = recorder.isStarted ? 'Recording Active' : 'Connected (Idle)';
        } else if (status === 'disconnected') {
             statusText = 'Idle';
        } else if (status === 'connecting' || status === 'authenticating') {
             statusText = 'Connecting...';
        } else if (status === 'ended') {
             statusText = message || 'Session Ended';
        } else if (status === 'error') {
             statusText = `Error: ${message || 'Unknown'}`;
        }

        if (statusEl) {
            statusEl.className = `player-status ${status}`;
            statusEl.textContent = statusText;
        }
    }

    // Add message to the recorder's specific log area
     function addStatusLog(recorder, message, isError = false) {
         if (!recorder || !recorder.element) return;
         const logEl = recorder.element.querySelector('.recorder-status-log');
         if (logEl) {
             const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
             const logEntry = document.createElement('div');
             logEntry.textContent = `[${time}] ${message}`;
             if (isError) logEntry.style.color = '#e74c3c'; // Red for errors
             logEl.appendChild(logEntry);
             logEl.scrollTop = logEl.scrollHeight; // Scroll to bottom
         } else {
             console.log(`Recorder ${recorder.id} Log: ${message}`); // Fallback to console if element not found
         }
     }

    function populateLanguageSelect(selectElement, selectedLanguage) {
        selectElement.innerHTML = '';
        const sortedLanguages = Object.entries(languageMap).sort(([, nameA], [, nameB]) => nameA.localeCompare(nameB));
        sortedLanguages.forEach(([code, name]) => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = name;
            selectElement.appendChild(option);
        });
        selectElement.value = selectedLanguage;
    }

    function populateDeviceSelect(selectElement, selectedDeviceId) {
        selectElement.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'System Default Input';
        selectElement.appendChild(defaultOption);

        state.devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Input ${device.deviceId.slice(0, 8)}...`;
            selectElement.appendChild(option);
        });

        if (selectedDeviceId && state.devices.find(d => d.deviceId === selectedDeviceId)) {
            selectElement.value = selectedDeviceId;
        } else {
            selectElement.value = '';
        }
    }

    function getDeviceName(deviceId) {
        if (!deviceId) return 'System Default Input';
        const device = state.devices.find(d => d.deviceId === deviceId);
        return device?.label || `Input ${deviceId.slice(0, 8)}...` || 'Unknown Input Device';
    }

    function getLanguageName(code) {
        return languageMap[code] || code;
    }

    // Update enable/disable state of Start buttons based on device usage
    function updateStartButtonStates(changedDeviceId = null) {
         state.recorders.forEach(recorder => {
             const startStopBtn = recorder.element.querySelector('.start-stop-btn');
             if (!startStopBtn || recorder.isStarted) { // Don't change if already started or no button
                 return;
             }

             // Disable if the device is active elsewhere, enable otherwise
             const isDeviceActiveElsewhere = state.activeDeviceIds.has(recorder.deviceId);
             startStopBtn.disabled = isDeviceActiveElsewhere;

             if (isDeviceActiveElsewhere && changedDeviceId === recorder.deviceId) {
                startStopBtn.title = `Device in use by another recorder.`;
             } else {
                startStopBtn.title = `Start/Stop sending audio`;
             }
         });
    }
     // Helper to update all buttons, e.g., after removing a recorder
     function updateAllStartButtonStates() {
         updateStartButtonStates(null); // Passing null ensures all are checked
     }

    function addRecorderEventListeners(recorderEl, recorder) {
        if (!recorder) return;

        const languageSelect = recorderEl.querySelector('.language-select');
        const deviceSelect = recorderEl.querySelector('.device-select');
        const nameInput = recorderEl.querySelector('.speaker-name-input');
        const headerControls = recorderEl.querySelector('.player-header .player-controls');
        const settingsControls = recorderEl.querySelector('.player-settings'); // Delegate from settings container

        // Language select change
        languageSelect.addEventListener('change', (e) => {
            const newLanguage = e.target.value;
            if (newLanguage === recorder.language || recorder.isStarted) {
                if(recorder.isStarted) {
                    showNotification("Stop recording before changing language.", 'error');
                    e.target.value = recorder.language; // Revert selection
                }
                return;
            }
            recorder.language = newLanguage;
            const newLanguageName = getLanguageName(newLanguage);
            recorderEl.querySelector('.player-language-indicator').textContent = newLanguageName;
            addStatusLog(recorder, `Language set to ${newLanguageName}. Restart recording if needed.`);
        });

        // Device select change
        deviceSelect.addEventListener('change', (e) => {
            const newDeviceId = e.target.value;
             if (newDeviceId === recorder.deviceId || recorder.isStarted) {
                if(recorder.isStarted) {
                    showNotification("Stop recording before changing input device.", 'error');
                    e.target.value = recorder.deviceId; // Revert selection
                }
                return;
            }
            recorder.deviceId = newDeviceId;
            const deviceName = getDeviceName(recorder.deviceId);
            addStatusLog(recorder, `Input device set to: ${deviceName}. Restart recording if needed.`);
             updateStartButtonStates(); // Check if new device selection conflicts
        });

        // Speaker Name change
        nameInput.addEventListener('input', (e) => {
            recorder.speakerName = e.target.value.trim();
            // If connected, changing name might require reconnect or specific API call?
            // For now, name is used mainly when connecting initially.
        });

        // --- Button Click Delegation ---

        headerControls.addEventListener('click', (e) => {
            if (e.target.matches('.collapse-btn')) {
                toggleRecorderCollapse(recorder);
            } else if (e.target.matches('.leave-btn')) {
                handleRecorderLeave(recorder);
            }
        });

        settingsControls.addEventListener('click', (e) => {
            if (e.target.matches('.start-stop-btn')) {
                if (recorder.isStarted) {
                    handleRecorderStop(recorder); // Handle stop logic
                } else {
                    handleRecorderStart(recorder); // Handle start logic
                }
            }
        });
    }


    function toggleRecorderCollapse(recorder) {
        recorder.collapsed = !recorder.collapsed;
        const contentEl = recorder.element.querySelector('.player-content');
        const collapseBtn = recorder.element.querySelector('.collapse-btn');
        if (!contentEl || !collapseBtn) return;

        contentEl.classList.toggle('collapsed', recorder.collapsed);
        collapseBtn.textContent = recorder.collapsed ? 'Expand' : 'Collapse';
    }

    function toggleAllRecorders() {
        state.allCollapsed = !state.allCollapsed;
        state.recorders.forEach(recorder => {
            if (recorder.collapsed !== state.allCollapsed) {
                toggleRecorderCollapse(recorder);
            }
        });
        globalCollapseBtn.textContent = state.allCollapsed ? 'Expand All' : 'Collapse All';
    }

    // --- Presets ---

    function loadPresetsFromStorage() {
        try {
            const savedPresets = localStorage.getItem('wordlyAudioRecorderPresets');
            if (savedPresets) {
                state.presets = JSON.parse(savedPresets);
                updatePresetDropdown();
            }
        } catch (error) {
            console.error('Error loading presets:', error);
            localStorage.removeItem('wordlyAudioRecorderPresets');
        }
    }

    function updatePresetDropdown() {
        const placeholder = presetSelect.options[0];
        presetSelect.innerHTML = '';
        presetSelect.appendChild(placeholder);
        Object.keys(state.presets).sort().forEach(presetName => {
            const option = document.createElement('option');
            option.value = presetName;
            option.textContent = presetName;
            presetSelect.appendChild(option);
        });
    }

    function savePreset() {
        const presetName = presetNameInput.value.trim();
        if (!presetName) { showNotification('Please enter a name for the preset', 'error'); return; }

        const presetConfig = {
            recorders: state.recorders.map(r => ({ // Save relevant config, not runtime state
                language: r.language,
                deviceId: r.deviceId,
                speakerName: r.speakerName,
                collapsed: r.collapsed
            }))
        };

        state.presets[presetName] = presetConfig;
        try {
            localStorage.setItem('wordlyAudioRecorderPresets', JSON.stringify(state.presets));
            updatePresetDropdown();
            showNotification(`Preset "${presetName}" saved`, 'success');
            presetNameInput.value = '';
            presetSelect.value = presetName;
        } catch (error) {
            console.error('Error saving preset:', error);
            showNotification('Error saving preset. Storage might be full.', 'error');
        }
    }

    function loadSelectedPreset() {
        const presetName = presetSelect.value;
        if (!presetName) { showNotification('Please select a preset to load', 'error'); return; }
        const preset = state.presets[presetName];
        if (!preset) { showNotification(`Preset "${presetName}" not found`, 'error'); return; }
        if (!state.sessionId) { showNotification('Connect to a session before loading a preset layout.', 'error'); return; }

        console.log(`Loading preset "${presetName}"`);
        const presetRecorderConfigs = preset.recorders || [];

        // Remove all existing recorders cleanly first
        // Use [...state.recorders] to avoid issues while iterating and modifying the array
        [...state.recorders].forEach(r => removeRecorder(r, false)); // Don't send disconnect for each when loading preset

        // Add recorders from the preset
        if (presetRecorderConfigs.length > 0) {
            presetRecorderConfigs.forEach(recorderConfig => {
                 // Add new recorder, it will be in idle state
                 addNewRecorder(recorderConfig);
            });
            showNotification(`Loaded preset "${presetName}". Click Start on desired recorders.`, 'success');
        } else {
            showNotification(`Preset "${presetName}" loaded (no recorders defined)`, 'info');
        }
         updateAllStartButtonStates(); // Update button states after loading
    }

    function deleteSelectedPreset() {
        const presetName = presetSelect.value;
        if (!presetName) { showNotification('Please select a preset to delete', 'error'); return; }
        if (confirm(`Are you sure you want to delete the preset "${presetName}"?`)) {
            delete state.presets[presetName];
            try {
                localStorage.setItem('wordlyAudioRecorderPresets', JSON.stringify(state.presets));
                updatePresetDropdown();
                presetSelect.value = '';
                showNotification(`Preset "${presetName}" deleted`, 'success');
            } catch (error) {
                console.error('Error deleting preset:', error);
                showNotification('Error deleting preset', 'error');
            }
        }
    }

    // --- Notifications ---

    function showNotification(message, type = 'info', duration = 3500) {
        const container = document.body; // Or another container element if preferred
        const existing = container.querySelector('.notification');
        // Simple approach: remove existing immediately
        if(existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        notification.style.opacity = '0'; // Start hidden
        notification.style.transition = 'opacity 0.5s ease-in-out'; // CSS transition

        container.appendChild(notification);

        // Trigger fade in
        requestAnimationFrame(() => {
            notification.style.opacity = '1';
        });

        // Set timeout to fade out and remove
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.addEventListener('transitionend', () => notification.remove(), { once: true });
            // Fallback removal if transitionend doesn't fire
            setTimeout(() => { if (notification.parentNode) notification.remove(); }, 600); // Slightly longer than transition
        }, duration);
    }

}); // End DOMContentLoaded
