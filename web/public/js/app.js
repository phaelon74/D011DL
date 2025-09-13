// Main javascript for the web portal
console.log('App JS loaded');

document.addEventListener('DOMContentLoaded', () => {
    let refreshIntervalId = null;
    let countdownIntervalId = null;
    let secondsLeft = 0;

    const refreshSelect = document.getElementById('refresh-interval');
    const refreshTimerSpan = document.getElementById('refresh-timer');

    function startRefresh(intervalSeconds) {
        stopRefresh();
        if (intervalSeconds > 0) {
            secondsLeft = intervalSeconds;
            refreshTimerSpan.textContent = `(refreshing in ${secondsLeft}s)`;
            
            countdownIntervalId = setInterval(() => {
                secondsLeft--;
                refreshTimerSpan.textContent = `(refreshing in ${secondsLeft}s)`;
            }, 1000);

            refreshIntervalId = setInterval(() => {
                location.reload();
            }, intervalSeconds * 1000);
        }
    }

    function stopRefresh() {
        clearInterval(refreshIntervalId);
        clearInterval(countdownIntervalId);
        refreshTimerSpan.textContent = '';
    }

    refreshSelect.addEventListener('change', (e) => {
        const interval = parseInt(e.target.value, 10);
        if (interval > 0) {
            startRefresh(interval);
        } else {
            stopRefresh();
        }
    });
    
    // Start with the default selected interval
    const initialInterval = parseInt(refreshSelect.value, 10);
    if (initialInterval > 0) {
        startRefresh(initialInterval);
    }
});
