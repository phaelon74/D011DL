// Main server entry point for the web portal
const express = require('express');
const cookieParser = require('cookie-parser');
const axios = require('axios');
require('dotenv').config({ path: '../.env' });

const app = express();
const port = process.env.PORT_WEB || 32001;
const API_BASE_URL = process.env.API_BASE_INTERNAL || 'http://api:32002';
const STORAGE_ROOT = process.env.STORAGE_ROOT || '/media/models';
const NET_STORAGE_ROOT = process.env.NET_STORAGE_ROOT || '/media/netmodels';

app.set('view engine', 'ejs');
app.set('views', './views');

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Middleware to check auth
const checkAuth = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        return res.redirect('/login');
    }
    res.locals.token = token;
    next();
};

app.get('/login', (req, res) => {
    res.render('login', { title: 'Login' });
});

app.post('/login', async (req, res) => {
    try {
        const response = await axios.post(`${API_BASE_URL}/auth/login`, req.body);
        const { token } = response.data;
        res.cookie('token', token, { httpOnly: true });
        res.redirect('/');
    } catch (error) {
        res.render('login', { title: 'Login', error: 'Invalid credentials' });
    }
});

app.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});

// Protected routes below
app.get('/', checkAuth, async (req, res) => {
    try {
        const modelsResponse = await axios.get(`${API_BASE_URL}/db/models`, {
            headers: { Authorization: `Bearer ${res.locals.token}` }
        });
        res.render('dashboard', { title: 'Dashboard', models: modelsResponse.data, storageRoot: STORAGE_ROOT, netStorageRoot: NET_STORAGE_ROOT });
    } catch (error) {
        if (error.response && error.response.status === 401) {
            return res.redirect('/login');
        }
        // Render with empty list and a transient message instead of hanging the page
        return res.render('dashboard', { title: 'Dashboard', models: [], error: 'API temporarily unavailable. Retrying shortly.', storageRoot: STORAGE_ROOT, netStorageRoot: NET_STORAGE_ROOT });
    }
});

app.post('/start-download', checkAuth, async (req, res) => {
    try {
        const { authorRepo } = req.body;
        const [author, repo] = authorRepo.split('/');

        if (!author || !repo) {
            // Handle error: invalid format
            return res.redirect('/');
        }
        
        const payload = {
            author,
            repo,
            revision: 'main', // Default to main branch
            selection: [{ path: '.', type: 'dir' }] // Indicates a full repo download
        };

        await axios.post(`${API_BASE_URL}/downloads`, payload, {
            headers: { Authorization: `Bearer ${res.locals.token}` }
        });

        res.redirect('/');
    } catch (error) {
        console.error("Failed to start download", error);
        res.redirect('/'); // Redirect home even on error
    }
});

app.post('/retry-download/:id', checkAuth, async (req, res) => {
    try {
        const { id } = req.params;
        await axios.post(`${API_BASE_URL}/downloads/${id}/retry`, {}, {
            headers: { Authorization: `Bearer ${res.locals.token}` }
        });
        res.redirect('/');
    } catch (error) {
        console.error("Failed to retry download", error);
        res.redirect('/');
    }
});

app.post('/rescan-model/:id', checkAuth, async (req, res) => {
    try {
        const { id } = req.params;
        await axios.post(`${API_BASE_URL}/models/${id}/rescan`, {}, {
             headers: { Authorization: `Bearer ${res.locals.token}` }
        });
        res.redirect('/');
    } catch (error) {
        console.error("Failed to rescan model", error);
        res.redirect('/');
    }
});

app.post('/copy-model/:id', checkAuth, async (req, res) => {
    try {
        const { id } = req.params;
        await axios.post(`${API_BASE_URL}/models/${id}/copy`, {}, {
             headers: { Authorization: `Bearer ${res.locals.token}` }
        });
        res.redirect('/');
    } catch (error) {
        console.error("Failed to copy model", error);
        res.redirect('/');
    }
});

// Retry from a model row (create a new full-repo download job)
app.post('/retry-model/:id', checkAuth, async (req, res) => {
    try {
        const { id } = req.params;
        // Load model details to construct payload
        const modelsResponse = await axios.get(`${API_BASE_URL}/db/models`, {
            headers: { Authorization: `Bearer ${res.locals.token}` }
        });
        const model = modelsResponse.data.find((m) => m.id === id);
        if (!model) return res.redirect('/');

        const payload = {
            author: model.author,
            repo: model.repo,
            revision: model.revision || 'main',
            selection: [{ path: '.', type: 'dir' }]
        };

        await axios.post(`${API_BASE_URL}/downloads`, payload, {
            headers: { Authorization: `Bearer ${res.locals.token}` }
        });
        res.redirect('/');
    } catch (error) {
        console.error('Failed to retry model download', error);
        res.redirect('/');
    }
});

app.post('/move-model/:id', checkAuth, async (req, res) => {
    try {
        const { id } = req.params;
        await axios.post(`${API_BASE_URL}/models/${id}/move`, {}, {
             headers: { Authorization: `Bearer ${res.locals.token}` }
        });
        res.redirect('/');
    } catch (error) {
        console.error("Failed to move model", error);
        res.redirect('/');
    }
});

app.post('/models/:id/rescan', checkAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const token = req.cookies.token;
        await axios.post(`${API_BASE_URL}/models/${id}/rescan`, {}, {
            headers: { Authorization: `Bearer ${token}` }
        });
        res.redirect('/');
    } catch (error) {
        console.error('Error rescanning model:', error.response ? error.response.data : error.message);
        res.redirect('/?error=rescan_failed');
    }
});

// Trigger scans
app.post('/scan-local', checkAuth, async (req, res) => {
    try {
        await axios.post(`${API_BASE_URL}/scan/local`, {}, {
            headers: { Authorization: `Bearer ${res.locals.token}` }
        });
    } catch (error) {
        console.error('Failed to trigger local scan', error.response ? error.response.data : error.message);
    }
    res.redirect('/');
});

app.post('/scan-network', checkAuth, async (req, res) => {
    try {
        await axios.post(`${API_BASE_URL}/scan/network`, {}, {
            headers: { Authorization: `Bearer ${res.locals.token}` }
        });
    } catch (error) {
        console.error('Failed to trigger network scan', error.response ? error.response.data : error.message);
    }
    res.redirect('/');
});

app.get('/delete-model/:id', checkAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const response = await axios.get(`${API_BASE_URL}/db/models`, {
             headers: { Authorization: `Bearer ${res.locals.token}` }
        });
        const model = response.data.find((m) => m.id === id);
        if (!model) return res.redirect('/');
        
        // Ensure locations is an array for older records
        if (!model.locations || model.locations.length === 0) {
            model.locations = [model.root_path];
        }

        res.render('delete-model', { title: 'Delete Model', model });
    } catch (error) {
        res.redirect('/');
    }
});

app.post('/delete-model/:id', checkAuth, async (req, res) => {
    try {
        const { id } = req.params;
        let { locationsToDelete } = req.body;
        if (typeof locationsToDelete === 'string') {
            locationsToDelete = [locationsToDelete];
        }
        
        await axios.post(`${API_BASE_URL}/models/${id}/delete`, { locationsToDelete }, {
             headers: { Authorization: `Bearer ${res.locals.token}` }
        });
        res.redirect('/');
    } catch (error) {
        console.error("Failed to delete model", error);
        res.redirect('/');
    }
});

// Immediate DB-only delete when the model has no on-disk locations
app.post('/delete-model-immediate/:id', checkAuth, async (req, res) => {
    try {
        const { id } = req.params;
        await axios.post(`${API_BASE_URL}/models/${id}/delete`, { locationsToDelete: [] }, {
             headers: { Authorization: `Bearer ${res.locals.token}` }
        });
        // API route expects locations; when empty, just delete DB record directly
        // Provide a specialized endpoint server-side if desired; for now, we fallback to full delete page if API rejects
        res.redirect('/');
    } catch (error) {
        try {
            // Fallback: call a dedicated API to purge model if implemented later
            res.redirect('/');
        } catch (e) {
            res.redirect('/');
        }
    }
});
// Placeholder for other routes
app.get('/models/:id', checkAuth, (req, res) => { res.send('Model details coming soon'); });
app.get('/downloads', checkAuth, (req, res) => { res.send('Downloads page coming soon'); });


app.listen(port, () => {
  console.log(`Web portal listening on port ${port}`);
});
