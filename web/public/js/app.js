// Main javascript for the web portal
console.log('App JS loaded');

document.addEventListener('DOMContentLoaded', () => {
    const hfUrlForm = document.getElementById('hf-url-form');
    if (hfUrlForm) {
        hfUrlForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const url = document.getElementById('hf-url').value;
            const resultDiv = document.getElementById('parsed-result');
            const treeContainer = document.getElementById('tree-container');
            
            try {
                // We need a way to get the token to the client-side JS
                // This is a complex topic (e.g., passing it on render, secure httponly cookies + refresh tokens)
                // For now, this part of the functionality will be incomplete without the token.
                // A full implementation would handle API calls from the browser.
                resultDiv.innerHTML = `Parsing is handled server-side, but client-side fetching from the API would be implemented here. <br> Submitted URL: <code>${url}</code>`;
                treeContainer.innerHTML = '';
                
            } catch (error) {
                resultDiv.innerHTML = `<p class="error">Could not parse URL.</p>`;
            }
        });
    }
});
