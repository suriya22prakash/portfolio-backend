const express = require("express")
const cors = require("cors")
const mongoose = require("mongoose")
const dns = require("dns")
require("dotenv").config();
const nodemailer = require("nodemailer");
const { cert } = require("firebase-admin/app");
const { getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

if (!getApps().length) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    initializeApp(serviceAccount
        ? { credential: cert(JSON.parse(serviceAccount)) }
        : undefined);
}
const firebaseAuth = getAuth();

const app = express()
app.use(cors())
app.use(express.json())

mongoose.set('strictQuery', false);
let databaseConnection;

const connectToDatabase = () => {
    if (!databaseConnection) {
        databaseConnection = mongoose.connect(process.env.MONGODB_URI)
            .then(() => console.log("connected to database"))
            .catch((err) => {
                databaseConnection = undefined;
                throw err;
            });
    }
    return databaseConnection;
};

app.use(async (req, res, next) => {
    try {
        await connectToDatabase();
        next();
    } catch (err) {
        console.error("Database connection failed:", err.message);
        res.status(503).json({ message: "Database unavailable" });
    }
});

const Projects = mongoose.model("projects", {
    title: String,
    category: String,
    description: String,
    technologies: [String],
    image: String,
    githubUrl: String,
    liveUrl: String,
    featured: Boolean,
    order: Number
}, "projects");

app.get("/getprojects", (req, res) => {
    Projects.find({})
        .then((retdata) => {
            const project = retdata
            // console.log(project)
            res.send(project)
        })
        .catch((err) => {
            console.log(err)
            res.status(500).json({ error: "Failed to fetch projects" })
        })
})

const blogSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        content: { type: String, required: true },
        tools: { type: [String], default: [] },

    }
);

const Blog = mongoose.model("blogs", blogSchema, "blogs");

const verifyToken = async (req, res, next) => {
    const token = req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : null;

    if (!token) return res.status(401).json({ message: "Authentication required" });

    try {
        req.user = await firebaseAuth.verifyIdToken(token);
        next();
    } catch {
        res.status(401).json({ message: "Invalid or expired token" });
    }
};

const requireAdmin = (req, res, next) => {
    if (req.user.uid !== process.env.ADMIN_UID) {
        return res.status(403).json({ message: "Admin access required" });
    }
    next();
};

app.get("/getblogs", (req, res) => {
    Blog.find({})
        .then((retdata) => {
            const blog = (retdata)
            // console.log(blog)
            res.send(blog)
        })
        .catch((err) => {
            console.log(err)
            res.send(err)
        })
})

const rateLimit = require("express-rate-limit");

const Message = mongoose.model("user-msg", {
    name: String,
    email: String,
    phone: Number,
    subject: String,
    msg: String,
}, "usermsg");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// Change these two numbers to adjust the limit
const MAX_REQUESTS = 10;              // messages allowed per IP
const WINDOW_MS = 15 * 60 * 1000;     // per 15 minutes

const limiter = rateLimit({
    windowMs: WINDOW_MS,
    max: MAX_REQUESTS,
    message: { message: "Too many messages, please try again later." },
});

app.post("/getmsg", limiter, async (req, res) => {
    const newmsg = new Message({
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,
        subject: req.body.sub,
        msg: req.body.msg,
    });

    try {
        await newmsg.save();
    } catch (err) {
        return res.status(400).json({ message: err.message });
    }

    // Message is saved. Email failure shouldn't make the request fail.
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: "suriyaprakash22092002@gmail.com",
            replyTo: newmsg.email,
            subject: `Portfolio message: ${newmsg.subject || "No subject"}`,
            text:
                `Name: ${newmsg.name}\n` +
                `Email: ${newmsg.email}\n` +
                `Phone: ${newmsg.phone || "-"}\n` +
                `Subject: ${newmsg.subject || "-"}\n\n` +
                `${newmsg.msg}`,
        });
    } catch (err) {
        console.error("Email failed:", err.message);
    }

    res.status(201).json(newmsg);
});


app.post("/addblogs", verifyToken, requireAdmin, async (req, res) => {
    const blog = new Blog({
        title: req.body.title,
        content: req.body.content,
        tools: req.body.category
    })

    try {
        const newBlog = await blog.save();
        res.status(201).json(newBlog);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});


if (require.main === module) {
    app.listen(process.env.PORT || 3000, () => {
        console.log(`server started on port ${process.env.PORT || 3000}`)
    })
}

module.exports = app;