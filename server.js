const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const bcrypt = require("bcrypt");
require("dotenv").config(); // ✅ Load environment variables from .env

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Express-session middleware setup
app.use(
    session({
        secret: process.env.SESSION_SECRET || "your_secret_key",
        resave: false,
        saveUninitialized: false,
        store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }), // ✅ Store sessions in MongoDB
        cookie: { secure: false }, // HTTPS हो तो true करें
    })
);

// ✅ Use the environment variable instead of hardcoding the connection string
mongoose
    .connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 5000, // Set timeout
    })
    .then(() => console.log("✅ Connected to MongoDB Atlas"))
    .catch((err) => {
        console.error("❌ MongoDB Connection Error:", err);
        process.exit(1); // Exit if connection fails
    });

// ✅ User Schema को मॉड्यूल स्तर पर परिभाषित करें
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
});
const User = mongoose.model("User", userSchema);

let activeCollection = "defaultCollection";

// ✅ Schema for storing metadata of sheets
const metadataSchema = new mongoose.Schema({
    sheetNames: [String],
});

const Metadata = mongoose.model("TableMetadata", metadataSchema);

// ✅ Set active collection
app.post("/api/setCollection", (req, res) => {
    activeCollection = req.body.collection;
    res.json({ message: `Active collection set to ${activeCollection}` });
});

// ✅ Add new sheet
app.post("/api/addSheet", async (req, res) => {
    const { sheetName } = req.body;

    if (!sheetName) {
        return res.status(400).json({ success: false, message: "Sheet name is required!" });
    }

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

// ✅ Get all available sheets
app.get("/api/getSheets", async (req, res) => {
    try {
        let metadata = await Metadata.findOne();
        res.json({ sheets: metadata ? metadata.sheetNames : [] });
    } catch (error) {
        res.status(500).json({ error: "Error fetching sheets" });
    }
});

// ✅ Define schema for storing table data
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

// ✅ Fetch table data
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

// ✅ Save or update table data
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

// ✅ DELETE Sheet API
app.delete("/api/deleteSheet", async (req, res) => {
    const { sheetName } = req.body;

    if (!sheetName) {
        return res.status(400).json({ success: false, message: "Sheet name is required!" });
    }

    try {
        // Step 1: Remove sheet name from metadata
        let metadata = await Metadata.findOne();
        if (metadata) {
            metadata.sheetNames = metadata.sheetNames.filter(name => name !== sheetName);
            await metadata.save();
        }

        // Step 2: Delete sheet data from "SheetData" collection
        const deleteResult = await TableModel.deleteOne({ collectionName: sheetName });

        if (deleteResult.deletedCount > 0) {
            res.json({ success: true, message: `Sheet "${sheetName}" deleted successfully.` });
        } else {
            res.status(404).json({ success: false, message: "Sheet not found!" });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal Server Error", error });
    }
});

// ✅ User Login API
app.post("/api/login", async (req, res) => {
    try {
        const bcrypt = require("bcrypt");

        console.log("लॉगिन अनुरोध प्राप्त हुआ:", req.body);
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: "यूजरनेम और पासवर्ड आवश्यक है",
                error: "INVALID_INPUT",
            });
        }

        const user = await User.findOne({ username }).exec();
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "यूजर नहीं मिला",
                error: "USER_NOT_FOUND",
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            // ✅ Ensure session is available
            if (!req.session) {
                return res.status(500).json({
                    success: false,
                    message: "सत्र प्रबंधन उपलब्ध नहीं है",
                    error: "SESSION_NOT_AVAILABLE",
                });
            }

            req.session.user = {
                id: user._id,
                username: user.username,
            };

            return res.json({
                success: true,
                message: "लॉगिन सफल",
                user: {
                    id: user._id,
                    username: user.username,
                },
            });
        } else {
            return res.status(401).json({
                success: false,
                message: "गलत क्रेडेंशियल्स",
                error: "INVALID_CREDENTIALS",
            });
        }
    } catch (error) {
        console.error("लॉगिन त्रुटि:", error);
        res.status(500).json({
            success: false,
            message: "सर्वर त्रुटि",
            error: error.message,
            errorCode: "INTERNAL_SERVER_ERROR",
            stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
        });
    }
});

app.post("/api/signup", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: "Username and password are required!" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword });

        await newUser.save();
        res.status(201).json({ message: "User registered successfully!" });

    } catch (error) {
        console.error("Signup Error:", error); // Logs error to console
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
});


// ✅ Default route
app.get("/", (req, res) => {
    res.send("✅ API is running!");
});

// ✅ Start server on PORT 5000
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server connected to port ${PORT}`);
});

// ✅ Export app for Vercel
module.exports = app;
