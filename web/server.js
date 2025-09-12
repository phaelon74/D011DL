// Main server entry point for the web portal
const express = require('express');
const cookieParser = require('cookie-parser');
const axios = require('axios');
require('dotenv').config({ path: '../.env' });

const app = express();
const port = process.env.PORT_WEB || 32001;
const API_BASE_URL = process.env.API_BASE_INTERNAL || 'http://api:32002';

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

app.get('/register', (req, res) => {
    res.render('register', { title: 'Register' });
});

app.post('/register', async (req, res) => {
     try {
        await axios.post(`${API_BASE_URL}/auth/register`, req.body);
        res.redirect('/login');
    } catch (error) {
        res.render('register', { title: 'Register', error: 'Could not create account' });
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
        res.render('dashboard', { title: 'Dashboard', models: modelsResponse.data });
    } catch (error) {
        res.redirect('/login'); // If token is invalid
    }
});

// Placeholder for other routes
app.get('/models/:id', checkAuth, (req, res) => { res.send('Model details coming soon'); });
app.get('/downloads', checkAuth, (req, res) => { res.send('Downloads page coming soon'); });


app.listen(port, () => {
  console.log(`Web portal listening on port ${port}`);
});
