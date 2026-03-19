require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/tasty-town')
    .then(() => console.log('✅ Connected to MongoDB Database!'))
    .catch((err) => console.error('❌ Database connection error:', err));

// ==========================================
// MODELS
// ==========================================

// NEW: Customer User Model
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // In a production app, use bcrypt to hash this!
    name: { type: String, required: true },
    phone: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    orderId: { type: String, required: true },
    otp: { type: String, required: true },
    customerUsername: { type: String, default: 'guest' }, // NEW: Link order to user
    name: { type: String, required: true },
    phone: { type: String, required: true },
    type: { type: String, required: true },
    items: { type: Array, required: true },
    preOrderFee: { type: Number, default: 0 },
    parcelCharge: { type: Number, default: 0 },
    total: { type: Number, required: true },
    status: { type: String, default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
}));

const Review = mongoose.model('Review', new mongoose.Schema({
    name: { type: String, required: true },
    rating: { type: Number, required: true },
    comment: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({
    isStoreOnline: { type: Boolean, default: true }
}));

const Menu = mongoose.model('Menu', new mongoose.Schema({
    menuData: { type: Object, required: true }
}));

// ==========================================
// API ROUTES
// ==========================================

// --- Admin Login ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const ADMIN_USER = process.env.ADMIN_USER || 'admin';
    const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        res.status(200).json({ success: true, message: 'Login successful' });
    } else {
        res.status(401).json({ success: false, error: 'Invalid username or password' });
    }
});

// --- NEW: Customer Auth ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, name, phone } = req.body;
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ error: 'Username already exists' });
        
        const newUser = new User({ username, password, name, phone });
        await newUser.save();
        res.status(201).json({ success: true, user: { username, name, phone } });
    } catch (error) { res.status(500).json({ error: 'Registration failed' }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username, password });
        if (!user) return res.status(401).json({ error: 'Invalid username or password' });
        
        res.status(200).json({ success: true, user: { username: user.username, name: user.name, phone: user.phone } });
    } catch (error) { res.status(500).json({ error: 'Login failed' }); }
});

// --- Orders ---
app.post('/api/orders', async (req, res) => {
    try {
        const orderId = `#TC-${Math.floor(1000 + Math.random() * 9000)}`;
        const otp = Math.floor(1000 + Math.random() * 9000).toString(); 
        
        const newOrder = new Order({ orderId, otp, ...req.body });
        const savedOrder = await newOrder.save();
        io.emit('new_order', savedOrder); 
        res.status(201).json({ message: 'Order placed!', order: savedOrder });
    } catch (error) { res.status(500).json({ error: 'Failed to place order' }); }
});

app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });
        res.status(200).json(orders);
    } catch (error) { res.status(500).json({ error: 'Failed to fetch orders' }); }
});

// NEW: Fetch specific user's order history
app.get('/api/orders/history/:username', async (req, res) => {
    try {
        const orders = await Order.find({ customerUsername: req.params.username }).sort({ createdAt: -1 });
        res.status(200).json(orders);
    } catch (error) { res.status(500).json({ error: 'Failed to fetch order history' }); }
});

app.put('/api/orders/:id/status', async (req, res) => {
    try {
        const updatedOrder = await Order.findByIdAndUpdate(
            req.params.id, { status: req.body.status }, { returnDocument: 'after' }
        );
        io.emit('order_status_updated', updatedOrder);
        res.status(200).json(updatedOrder);
    } catch (error) { res.status(500).json({ error: 'Failed to update order' }); }
});

// --- Reviews ---
app.post('/api/reviews', async (req, res) => {
    try {
        const newReview = new Review(req.body);
        const savedReview = await newReview.save();
        io.emit('new_review', savedReview);
        res.status(201).json(savedReview);
    } catch (error) { res.status(500).json({ error: 'Failed to save review' }); }
});

app.get('/api/reviews', async (req, res) => {
    try {
        const reviews = await Review.find().sort({ createdAt: -1 });
        res.status(200).json(reviews);
    } catch (error) { res.status(500).json({ error: 'Failed to fetch reviews' }); }
});

// --- Store Status ---
app.post('/api/status', async (req, res) => {
    try {
        let settings = await Settings.findOne();
        if (!settings) settings = new Settings();
        settings.isStoreOnline = req.body.isStoreOnline;
        await settings.save();
        io.emit('store_status_changed', settings.isStoreOnline);
        res.status(200).json(settings);
    } catch (error) { res.status(500).json({ error: 'Failed to update status' }); }
});

// --- Menu & Inventory ---
app.post('/api/menu', async (req, res) => {
    try {
        let menu = await Menu.findOne();
        if (!menu) menu = new Menu();
        menu.menuData = req.body.menuData;
        await menu.save();
        io.emit('menu_updated', menu.menuData);
        res.status(200).json({ message: 'Menu saved!' });
    } catch (error) { res.status(500).json({ error: 'Failed to save menu' }); }
});

app.get('/api/menu', async (req, res) => {
    try {
        const menu = await Menu.findOne();
        res.status(200).json(menu ? menu.menuData : null);
    } catch (error) { res.status(500).json({ error: 'Failed to fetch menu' }); }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));