const text = document.querySelector('#text');
document.querySelector('#stop').addEventListener('click', () => window.botdesk.emergencyStop());
window.botdesk.onStatus((status) => { text.textContent = status.mode === 'running' ? 'BOT IS CONTROLLING THIS PC' : 'BOT CONTROL ARMED'; });
