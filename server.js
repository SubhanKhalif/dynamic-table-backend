// api/index.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const bcrypt = require("bcrypt");
require("dotenv").config();

const app = express();

// CORS configuration
app.use(cors({
    origin: '*', // You can specify domains in production
    methods: ['GET', 'POST', 'DELETE'],
}));

// Middleware to parse incoming JSON requests
app.use(express.json());

// Session setup
app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        store: MongoStore.create({
            mongoUrl: process.env.MONGO_URI,
            collectionName: 'sessions',
        }),
        cookie: {
            secure: process.env.NODE_ENV === 'production', // Set to true if using HTTPS
        },
    })
);

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch((err) => {
        console.error("❌ MongoDB connection error:", err);
        process.exit(1); // Exit if MongoDB fails to connect
    });

// Define the schemas and models
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true, minlength: 3 },
    password: { type: String, required: true, minlength: 6 },
});
const User = mongoose.model("User", userSchema);

const metadataSchema = new mongoose.Schema({
    sheetNames: [String],
});
const Metadata = mongoose.model("TableMetadata", metadataSchema);

const tableSchema = new mongoose.Schema({
    collectionName: String,
    rows: Number,
    columns: Number,
    data: [
        {
            row: Number,
            col: Number,
            value: String,
        },
    ],
});
const TableModel = mongoose.model("SheetData", tableSchema);

let activeCollection = "defaultCollection";

// API routes
app.post("/api/setCollection", (req, res) => {
    activeCollection = req.body.collection;
    res.json({ message: `Active collection set to ${activeCollection}` });
});

app.post("/api/addSheet", async (req, res) => {
    const { sheetName } = req.body;
    if (!sheetName) return res.status(400).json({ success: false, message: "Sheet name is required!" });

    try {
        let metadata = await Metadata.findOne();
        if (!metadata) {
            metadata = new Metadata({ sheetNames: [sheetName] });
        } else if (!metadata.sheetNames.includes(sheetName)) {
            metadata.sheetNames.push(sheetName);
        } else {
            return res.json({ success: false, message: "Sheet already exists!" });
        }

        await metadata.save();
        res.json({ success: true, message: "Sheet added successfully" });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error adding sheet" });
    }
});

app.get("/api/getSheets", async (req, res) => {
    try {
        let metadata = await Metadata.findOne();
        res.json({ sheets: metadata ? metadata.sheetNames : [] });
    } catch (error) {
        res.status(500).json({ error: "Error fetching sheets" });
    }
});

app.get("/api/getTable", async (req, res) => {
    try {
        const table = await TableModel.findOne({ collectionName: activeCollection });

        if (!table) {
            return res.json({ metadata: { rows: 5, columns: 5 }, data: [] });
        }

        res.json({ metadata: { rows: table.rows, columns: table.columns }, data: table.data });
    } catch (error) {
        res.status(500).json({ error: "Error fetching table data" });
    }
});

app.post("/api/saveTable", async (req, res) => {
    const { rows, columns, data } = req.body;
    try {
        await TableModel.findOneAndUpdate(
            { collectionName: activeCollection },
            { rows, columns, data },
            { upsert: true }
        );
        res.json({ message: "Table data saved successfully" });
    } catch (error) {
        res.status(500).json({ error: "Error saving table data" });
    }
});

app.delete("/api/deleteSheet", async (req, res) => {
    const { sheetName } = req.body;
    if (!sheetName) return res.status(400).json({ success: false, message: "Sheet name is required!" });

    try {
        let metadata = await Metadata.findOne();
        if (metadata) {
            metadata.sheetNames = metadata.sheetNames.filter(name => name !== sheetName);
            await metadata.save();
        }

        const deleteResult = await TableModel.deleteOne({ collectionName: sheetName });
        if (deleteResult.deletedCount > 0) {
            res.json({ success: true, message: `Sheet "${sheetName}" deleted successfully` });
        } else {
            res.status(404).json({ success: false, message: "Sheet not found!" });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error", error });
    }
});

app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: "Username and password are required" });

    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ success: false, message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (isMatch) {
        req.session.user = { id: user._id, username: user.username };
        return res.json({ success: true, message: "Login successful", user: { id: user._id, username: user.username } });
    } else {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
});

app.post("/api/signup", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Username and password are required!" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });

    await newUser.save();
    res.status(201).json({ message: "User registered successfully!" });
});

// Health check route
app.get("/", (req, res) => res.send("✅ API is running!"));

// Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: "Something went wrong!" });
});

// Export the app
module.exports = app;
