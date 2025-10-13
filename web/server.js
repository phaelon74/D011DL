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
        const models = modelsResponse.data || [];
        // Enrich with HF status for TheHouseOfTheDude; allow upload if branch is missing or empty (ignoring .gitattributes and .init-<rev>)
        const enriched = await Promise.all(models.map(async (m) => {
            if (!(m && m.author === 'TheHouseOfTheDude')) return { ...m, canHfUp: false };
            const rev = encodeURIComponent(m.revision || 'main');
            try {
                const resp = await axios.get(`https://huggingface.co/api/models/${m.author}/${m.repo}/tree/${rev}`, { timeout: 5000 });
                const list = Array.isArray(resp.data) ? resp.data : [];
                const files = list.filter((f) => f && f.type === 'file');
                const ignored = new Set([`.gitattributes`, `.init-${m.revision || 'main'}`]);
                const nonInitFiles = files.filter((f) => !ignored.has(f.path));
                const canHfUp = nonInitFiles.length === 0; // branch exists but empty (or only init)
                return { ...m, canHfUp };
            } catch (e) {
                // 404 or network -> treat as missing: allow HFUP to create repo/branch
                return { ...m, canHfUp: true };
            }
        }));
        // Group by author+repo for single-row display with nested revisions
        const groupsMap = new Map();
        for (const m of enriched) {
            const key = `${m.author}/${m.repo}`;
            if (!groupsMap.has(key)) {
                groupsMap.set(key, { author: m.author, repo: m.repo, revisions: [] });
            }
            groupsMap.get(key).revisions.push(m);
        }
        const groups = Array.from(groupsMap.values()).map(g => {
            // Sort revisions by name for consistent display
            g.revisions.sort((a, b) => String(a.revision || 'main').localeCompare(String(b.revision || 'main')));
            return g;
        });

        res.render('dashboard', { title: 'Dashboard', models: enriched, groups, storageRoot: STORAGE_ROOT, netStorageRoot: NET_STORAGE_ROOT });
    } catch (error) {
        if (error.response && error.response.status === 401) {
            return res.redirect('/login');
        }
        // Render with empty list and a transient message instead of hanging the page
        return res.render('dashboard', { title: 'Dashboard', models: [], groups: [], error: 'API temporarily unavailable. Retrying shortly.', storageRoot: STORAGE_ROOT, netStorageRoot: NET_STORAGE_ROOT });
    }
});

app.post('/start-download', checkAuth, async (req, res) => {
    try {
        const { authorRepo } = req.body;
        const [author, repo] = (authorRepo || '').split('/');

        if (!author || !repo) {
            return res.redirect('/');
        }

        // Check for revisions (branches/tags) on Hugging Face
        try {
            const refsResp = await axios.get(`https://huggingface.co/api/models/${author}/${repo}/refs`, { timeout: 7000 });
            const branches = Array.isArray(refsResp.data?.branches) ? refsResp.data.branches : [];
            const tags = Array.isArray(refsResp.data?.tags) ? refsResp.data.tags : [];
            const revisionNames = [
                ...branches.map((b) => b?.name).filter(Boolean),
                ...tags.map((t) => t?.name).filter(Boolean)
            ];

            const uniqueRevisions = Array.from(new Set(revisionNames));
            const onlyMain = uniqueRevisions.length === 0 || (uniqueRevisions.length === 1 && uniqueRevisions[0] === 'main');

            if (!onlyMain) {
                // Redirect to selection page similar to delete page UI
                return res.redirect(`/select-revisions?author=${encodeURIComponent(author)}&repo=${encodeURIComponent(repo)}`);
            }
        } catch (e) {
            // If refs endpoint fails, fall back to main
        }

        const payload = {
            author,
            repo,
            revision: 'main',
            selection: [{ path: '.', type: 'dir' }]
        };

        await axios.post(`${API_BASE_URL}/downloads`, payload, {
            headers: { Authorization: `Bearer ${res.locals.token}` }
        });

        res.redirect('/');
    } catch (error) {
        console.error('Failed to start download', error);
        res.redirect('/');
    }
});

// Revision selection page (similar to delete page) when multiple revisions exist
app.get('/select-revisions', checkAuth, async (req, res) => {
    try {
        const author = (req.query.author || '').toString();
        const repo = (req.query.repo || '').toString();
        if (!author || !repo) return res.redirect('/');

        let branches = [];
        let tags = [];
        try {
            const refsResp = await axios.get(`https://huggingface.co/api/models/${author}/${repo}/refs`, { timeout: 7000 });
            branches = Array.isArray(refsResp.data?.branches) ? refsResp.data.branches : [];
            tags = Array.isArray(refsResp.data?.tags) ? refsResp.data.tags : [];
        } catch (e) {
            // If we cannot load refs, fallback to immediate main download for UX
            return res.redirect('/');
        }

        const revisionNames = [
            ...branches.map((b) => b?.name).filter(Boolean),
            ...tags.map((t) => t?.name).filter(Boolean)
        ];
        const uniqueRevisions = Array.from(new Set(revisionNames));

        if (uniqueRevisions.length === 0 || (uniqueRevisions.length === 1 && uniqueRevisions[0] === 'main')) {
            return res.redirect('/');
        }

        res.render('select-revisions', {
            title: 'Select Revisions',
            author,
            repo,
            revisions: uniqueRevisions
        });
    } catch (error) {
        return res.redirect('/');
    }
});

// Queue downloads for one or multiple selected revisions
app.post('/queue-downloads', checkAuth, async (req, res) => {
    try {
        const { author, repo } = req.body;
        let { revisions } = req.body;
        if (!author || !repo) return res.redirect('/');

        if (!revisions) {
            return res.redirect('/');
        }
        if (typeof revisions === 'string') {
            revisions = [revisions];
        }
        const selected = (Array.isArray(revisions) ? revisions : []).map((r) => String(r)).filter(Boolean);
        if (selected.length === 0) return res.redirect('/');

        // Queue a job per revision
        await Promise.all(selected.map((rev) => {
            const payload = {
                author,
                repo,
                revision: rev,
                selection: [{ path: '.', type: 'dir' }]
            };
            return axios.post(`${API_BASE_URL}/downloads`, payload, {
                headers: { Authorization: `Bearer ${res.locals.token}` }
            }).catch(() => {});
        }));

        res.redirect('/');
    } catch (error) {
        res.redirect('/');
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
        const { sourcePath, destinationRoot } = req.body || {};
        await axios.post(`${API_BASE_URL}/models/${id}/copy`, { sourcePath, destinationRoot }, {
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

// Trigger HF upload for a model
app.post('/hf-upload/:id', checkAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { revision } = req.body || {};
        await axios.post(`${API_BASE_URL}/uploads/${id}`, { revision }, {
            headers: { Authorization: `Bearer ${res.locals.token}` }
        });
        res.redirect('/');
    } catch (error) {
        console.error('Failed to start HF upload', error.response ? error.response.data : error.message);
        res.redirect('/');
    }
});

app.post('/move-model/:id', checkAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { sourcePath, destinationRoot } = req.body || {};
        await axios.post(`${API_BASE_URL}/models/${id}/move`, { sourcePath, destinationRoot }, {
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
        let { locationsToDelete, removeFromDb } = req.body;
        if (typeof locationsToDelete === 'string') {
            locationsToDelete = [locationsToDelete];
        }
        const payload = { locationsToDelete: locationsToDelete || [], removeFromDb: !!removeFromDb };
        
        await axios.post(`${API_BASE_URL}/models/${id}/delete`, payload, {
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
