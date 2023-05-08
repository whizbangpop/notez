// Express Imports
import express from "express";
import session from "express-session";
import bodyParser from "body-parser";
import morgan from "morgan";

// Passport Imports
import passport from "passport";
import passportLocalMongoose from "passport-local-mongoose";
import githubStrategy from "passport-github2";
import discordStrategy from "passport-discord";
import refresh from "passport-oauth2-refresh";

// Sentry Imports
import sentry from "@sentry/node";
import tracing from "@sentry/tracing";

// Misc Imports
import mongoose, { Mongoose } from "mongoose";
import path from "path";
import simpleNodeLogger from "simple-node-logger";
import https from "https";
import fs from "fs";

// Config Imports
import config from "./config.json" assert {
	type: 'json',
	integrity: 'sha384-ABC123'
};
import allowedUsers from "./allowedUser.json" assert {
	type: 'json',
	integrity: 'sha384-ABC123'
};

// Firebase Imports
import { initializeApp } from "@firebase/app";
import { getStorage, ref, getDownloadURL, getBlob, getStream } from "@firebase/storage";
import { Storage } from "@google-cloud/storage";
import { url } from "inspector";

// Create Simple Node Logger instance
const log = simpleNodeLogger.createSimpleLogger("logs/notez-backend.log");

// Create Express Server
const server = express();
log.debug("Express server created");

// Initialise & Connect Sentry Middleware
sentry.init({
	dsn: config.sentry.dsn,
	integrations: [
		new sentry.Integrations.Http({ tracing: true }),
		new tracing.Integrations.Express({ server }),
	],
	tracesSampleRate: 0.85,
});

server.use(sentry.Handlers.requestHandler());
server.use(sentry.Handlers.tracingHandler());
log.debug("Sentry initialised & connected");

// Initialise & Connect to Firebase Blob Storage
log.debug("Connecting to Firebase Blob Storage");
const fBase = initializeApp(config.firebaseConfig);
/** The root Firebase Blob Storage folder */
const blobStorage = getStorage(fBase);
log.info("Connected to Firebase Blob Storage");

// Generic Express Middleware Setup
// server.use(express.static("dist"));
server.use(bodyParser.urlencoded({
	extended: true
}));
server.use(express.json());
server.use(express.urlencoded());
server.set('view engine', 'ejs');
log.debug("Express Middleware configured");

// Configure Morgan
server.use(morgan(":method :url :status :response-time ms - :res[content-length]"));
log.debug("Morgan configured");

// Configure Express Sessions
server.use(session({
	secret: config.server.secret,
	resave: false,
	saveUninitialized: false
}));
log.debug("Express sessions configured");

// Initialise & Connect Passport
// Thus *may* be changing to Firebase Auth, still looking into it
server.use(passport.initialize());
server.use(passport.session());
log.debug("Passport configured");

// Connect to MongoDB database
log.debug("Connecting to MongoDB")
mongoose.connect(config.db.connector, {
	useNewUrlParser: true,
	useUnifiedTopology: true
});
log.info("Connected to MongoDB");

// Create Basic Note Schema
const noteSchema = new mongoose.Schema({
	title: String,
	content: String,
	id: String,
	public: Boolean,
	ownerId: String,
	ownerName: String
});
const Note = new mongoose.model("NotesTable", noteSchema);
log.debug("Note schema created");

// Configure Passport Strategys
passport.use(new githubStrategy({
	clientID: config['github-oauth'].client_id,
	clientSecret: config['github-oauth'].client_secret,
	callbackURL: `${config.server.url}/auth/github/callback`
},
	function (accessToken, refreshToken, profile, done) {
		process.nextTick(function () {
			return done(null, profile);
		});
	}
));
log.debug("Created GitHub Passport strategy");

const discordStrat = new discordStrategy({
	clientID: config['discord-oauth'].client_id,
	clientSecret: config['discord-oauth'].client_secret,
	callbackURL: `${config.server.url}/auth/discord/callback`,
	scope: ['identify', 'email']
},
	function (accessToken, refreshToken, profile, done) {
		process.nextTick(function () {
			profile.refreshToken = refreshToken;
			return done(null, profile);
		});
	});
passport.use(discordStrat);
refresh.use(discordStrat);
log.debug("Created Discord Passport strategy");

// Passport Things
passport.serializeUser(function (user, done) {
	done(null, user);
});

passport.deserializeUser(function (obj, done) {
	done(null, obj);
});

// Passport Auth Routes
server.get("/auth/github", passport.authenticate("github", { scope: ['user:email'] }), function (req, res) { });
server.get("/auth/github/callback", passport.authenticate('github', { failureRedirect: '/login' }), function (req, res) {
	res.redirect('/')
})

server.get("/auth/discord", passport.authenticate('discord'));
server.get("/auth/discord/callback", passport.authenticate('discord', { failureRedirect: "/login" }), function (req, res) {
	res.redirect('/')
})

// Custom EnsureAuth Function
function ensureAuth(req, res, next) {
	try {
		if (!allowedUsers.includes(req.user.id)) {
			return res.redirect('/logout')
		}

		if (req.isAuthenticated()) { return next(); }
		else res.redirect('/login')
	} catch (error) {
		if (req.isAuthenticated()) { return next(); }
		else res.redirect('/login')
	}

}

// Main App Routes
// Notes Home Page/Where you see all of your notes
server.get("/", ensureAuth, async (req, res) => {
	const data = await Note.find({ ownerId: req.user.id });
	res.render("spa/notes", { user: req.user, notesArray: data });
});
// Create new note
server.get("/notes/new", ensureAuth, async (req, res) => {
	res.render('spa/new', { user: req.user });
});
server.post("/notes/new", async (req, res) => {
	if (!req.user || req.isUnauthenticated()) {
		return res.redirect("/login");
	};

	const newNote = new Note();
	const modId = req.body.noteTitle.replace(/[^0-9a-z]/gi, '');
	const modContent = req.body.noteContent.replace(new RegExp('\r?\n', 'g'), '<br />');

	newNote.title = req.body.noteTitle;
	newNote.content = modContent;
	newNote.id = `${modId}-${req.body.userid}`;
	newNote.ownerId = req.body.userId;
	newNote.ownerName = req.body.username;
	newNote.public = false;
	newNote.save();

	res.redirect(`/notes/${modId}-${req.body.userid}`);
});
// Note Viewer
server.get("/notes/:id", async (req, res) => {
	try {
		const noteObj = await Note.fineOne({ id: req.params.id });
		if (!noteObj || noteObj === undefined) {
			return res.status(404).send("Unknown id");
		};

		if (!noteObj.public) {
			if (!req.user || req.isUnauthenticated()) {
				return res.redirect("/login");
			} else {
				return res.render("spa/note-viewer", { noteName: noteObj.title, noteContent: noteObj.content, createdOn: "undefined", id: req.params.id });
			}
		} else {
			return res.render("spa/note-viewer", { noteName: noteObj.title, noteContent: noteObj.content, createdOn: "etst-1", id: req.params.id })
		};
	} catch (e) {
		throw new Error(e);
	};
});
// Note Editor
server.get("/notes/edit/:id", ensureAuth, async (req, res) => {
	try {
		if (!req.user || req.isUnauthenticated()) {
			return res.render("/login");
		};

		const noteData = await Note.findOne({ id: req.params.id });
		return res.render('spa/editor', { noteName: data.title, noteContent: data.content, user: req.user, noteId: req.params.id });
	} catch (e) {
		throw new Error(e)
	};
});
server.post("/notes/edit/:id", async (req, res) => {
	try {
		if (!req.user || req.isUnauthenticated()) {
			return res.redirect("/login");
		};

		const modContent = req.body.noteContent.replace(new RegExp('\r?\n', 'g'), '<br />');
		const noteObj = await Note.findOneAndUpdate({ id: req.params.id });

		if (!noteObj || noteObj === undefined) {
			return res.status(404).send("Unknown note");
		};

		noteObj.title = req.body.noteTitle;
		noteObj.content = modContent;
		noteObj.public = false;
		noteObj.save();

		return res.redirect(`/notes/${req.params.id}`);
	} catch (e) {
		throw new Error(e);
	};
});
// Note Delete 
server.get("/notes/delete/:id", ensureAuth, async (req, res) => {
	try {
		if (!req.user || req.isUnauthenticated()) {
			return res.redirect("/login");
		};

		const noteObj = await Note.deleteOne({ id: req.params.id });
		return res.render("spa/deleted", { noteName: req.params.id });
	} catch (e) {
		throw new Error(e);
	}
})

// Media Manager
server.get("/media/:userid/:mediatype/:filename", async (req, res) => {
	try {
		const mediaRef = ref(blobStorage, `public/${req.params.userid}/${req.params.mediatype}/${req.params.filename}`)

		getDownloadURL(ref(blobStorage, mediaRef)).then((url) => {
			res.render('imgs/viewer', { imgTitle: mediaRef.name, imgSrc: url });
		}).catch((e) => res.status(504).send("Theres a high chance that that file does not exist."));
	} catch (e) {
		return res.status(504).send("Theres a high chance that that file does not exist.")
	}
});

// Authentication Endpoints
server.get("/login", async (req, res) => {
	if (req.isAuthenticated()) {
		return res.redirect("/");
	} else {
		return res.render("login");
	};
})
server.get("/logout", ensureAuth, async (req, res) => {
	try {
		req.logout(function (err) {
			if (err) { throw new Error(err); };
			return res.render('logout');
		});
	} catch (e) {
		throw new Error(e);
	};
});

// Sentry Error Handling
server.use(sentry.Handlers.errorHandler());
server.use(function onError(err, req, res, next) {
	res.statusCode = 500;
	res.end(res.sentry + "\n");
	log.error(err);
});

server.listen(4000, () => {
	log.info(`Server is live at http://localhost:4000`);
});