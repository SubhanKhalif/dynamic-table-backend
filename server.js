const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const bcrypt = require("bcrypt");
require("dotenv").config(); // Load environment variables from .env

const app = express();

// Middleware to check if essential environment variables are set
if (!process.env.SESSION_SECRET || !process.env.MONGO_URI) {
    console.error('❌ Missing essential environment variables.');
    process.exit(1);
}

// CORS configuration to allow all origins (use only for development or specific cases)
app.use(cors({
    origin: '*', // Allow all origins for testing, use specific domains for production
    methods: ['GET', 'POST', 'DELETE'],
}));

// Middleware to parse incoming JSON requests
app.use(express.json());

// Express-session middleware setup
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
            secure: process.env.NODE_ENV === 'production', // Set to true if using HTTPS in production
        },
    })
);

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds
})
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch((err) => {
        console.error("❌ MongoDB connection error:", err);
        process.exit(1); // Exit the process if MongoDB connection fails
    });

// Define your routes here (same as you had before)

app.get("/", (req, res) => {
    res.send("✅ API is running!");
});

// Export serverless function
module.exports = (req, res) => {
    app(req, res); // Pass requests to express app
};
