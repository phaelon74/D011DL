// Main javascript for the web portal
console.log('App JS loaded');

document.addEventListener('DOMContentLoaded', () => {
    let refreshIntervalId = null;
    let countdownIntervalId = null;
    let secondsLeft = 0;

    // Support current IDs used in dashboard.ejs (camelCase)
    const refreshSelect = document.getElementById('refreshInterval') || document.getElementById('refresh-interval');
    const refreshTimerSpan = document.getElementById('refreshTimer') || document.getElementById('refresh-timer');

    if (!refreshSelect || !refreshTimerSpan) {
        return; // Page without refresh controls
    }

    function startRefresh(intervalSeconds) {
        stopRefresh();
        if (intervalSeconds > 0) {
            secondsLeft = intervalSeconds;
            refreshTimerSpan.textContent = `(refreshing in ${secondsLeft}s)`;
            
            countdownIntervalId = setInterval(() => {
                secondsLeft = Math.max(0, secondsLeft - 1);
                refreshTimerSpan.textContent = `(refreshing in ${secondsLeft}s)`;
            }, 1000);

            refreshIntervalId = setInterval(() => {
                try {
                    // Persist only across our own auto reloads
                    sessionStorage.setItem('autoRefreshReload', '1');
                    sessionStorage.setItem('autoRefreshInterval', String(intervalSeconds));
                } catch {}
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
    
    // Initialize behavior: persist across auto reloads only
    let initialInterval = 0;
    try {
        const fromAuto = sessionStorage.getItem('autoRefreshReload') === '1';
        if (fromAuto) {
            const saved = parseInt(sessionStorage.getItem('autoRefreshInterval') || '0', 10);
            if (saved > 0) {
                initialInterval = saved;
                refreshSelect.value = String(saved);
            }
            // Clear the flag so manual refresh resets to default next time
            sessionStorage.removeItem('autoRefreshReload');
        } else {
            // Manual refresh: clear any saved value and default to Off
            sessionStorage.removeItem('autoRefreshInterval');
            refreshSelect.value = '0';
        }
    } catch {}

    if (initialInterval > 0) {
        startRefresh(initialInterval);
    }
});
