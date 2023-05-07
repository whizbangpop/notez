const Express = require('express');
const Passport = require('passport');
const Mongoose = require('mongoose');
const Session = require('express-session');
const PassportLocalMongoose = require('passport-local-mongoose');
const GitHubStrategy = require('passport-github2').Strategy;
const DiscordStrategy = require('passport-discord').Strategy;
const Refresh = require('passport-oauth2-refresh');
const Path = require("path");

const Sentry = require('@sentry/node');
const Tracing = require('@sentry/tracing');

const bodyParser = require('body-parser');
const config = require('./config.json');
const allowedUsers = require('./allowedUser.json');

const app = Express();
const port = 4000;

Sentry.init({
	dsn: config.sentry.dsn,
	integrations: [
		// enable HTTP calls tracing
		new Sentry.Integrations.Http({ tracing: true }),
		// enable Express.js middleware tracing
		new Tracing.Integrations.Express({ app }),
	],

	// Set tracesSampleRate to 1.0 to capture 100%
	// of transactions for performance monitoring.
	// We recommend adjusting this value in production
	tracesSampleRate: 1.0,
});

app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());

app.use(Express.static("dist"));
app.use(bodyParser.urlencoded({
	extended: true
}));
app.use(Express.json());
app.use(Express.urlencoded());
app.set('view engine', 'ejs');

app.use(Session({
	secret: config.server.secret,
	resave: false,
	saveUninitialized: false
}));

app.use(Passport.initialize());
app.use(Passport.session());

Mongoose.connect(config.db.connector, {
	useNewUrlParser: true,
	useUnifiedTopology: true
})

const userSchema = new Mongoose.Schema({
	email: String,
	password: String
})
userSchema.plugin(PassportLocalMongoose);

const noteSchema = new Mongoose.Schema({
	title: String,
	content: String,
	id: String, // UserID + Title
	public: Boolean, // Default to False (private)
	ownerId: String,
	ownerName: String
})

const User = new Mongoose.model("UserAuthTable", userSchema);
const Note = new Mongoose.model("NotesTable", noteSchema);
Passport.use(User.createStrategy());

Passport.use(new GitHubStrategy({
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

const discordStrat = new DiscordStrategy({
	clientID: config['discord-oauth'].client_id,
	clientSecret: config['discord-oauth'].client_secret,
	callbackURL: `${config.server.url}/auth/discord/callback`,
	scope: ['identify', 'email']
},
	function (accessToken, refreshToken, profile, done) {
		process.nextTick(function () {
			profile.refreshToken = refreshToken
			return done(null, profile);
		});
	})
Passport.use(discordStrat)
Refresh.use(discordStrat)

Passport.serializeUser(function (user, done) {
	done(null, user);
});

Passport.deserializeUser(function (obj, done) {
	done(null, obj);
});

app.get("/auth/github", Passport.authenticate('github', { scope: ['user:email'] }), function (req, res) { });
app.get("/auth/github/callback", Passport.authenticate('github', { failureRedirect: '/login' }), function (req, res) {
	res.redirect('/')
})

app.get("/auth/discord", Passport.authenticate('discord'));
app.get("/auth/discord/callback", Passport.authenticate('discord', { failureRedirect: "/login" }), function (req, res) {
	res.redirect('/')
})

app.get("/", ensureAuth, async (req, res) => {
	const data = await Note.find({ ownerId: req.user.id });
	const notesArray = []
	res.render('spa/notes', { user: req.user, notesArray: data })
})

app.get("/notes/new", ensureAuth, async (req, res) => {
	res.render('spa/new', { user: req.user })
})
app.post("/notes/new", async (req, res) => {
	if (!req.user || req.isUnauthenticated()) {
		return res.redirect("/login")
	}

	const newNote = new Note()
	const title1 = req.body.noteTitle.replace(/[^0-9a-z]/gi, '')
	const conten1 = req.body.noteContent.replace(new RegExp('\r?\n', 'g'), '<br />');

	newNote.title = req.body.noteTitle;
	newNote.content = conten1;
	newNote.id = `${title1}-${req.body.userid}`;
	newNote.ownerId = req.body.userid;
	newNote.ownerName = req.body.username;
	newNote.public = false
	newNote.save()
	res.redirect(`/notes/${title1}-${req.body.userid}`)
})

app.get("/notes/:id", async (req, res) => {
	try {
		console.log(req.params)
		const noteObj = await Note.findOne({ id: req.params.id });
		if (!noteObj || noteObj === undefined) {
			return res.status(404).send("Cannot find note")
		}

		if (!noteObj.public) {
			if (!req.user || req.isUnauthenticated()) {
				return res.redirect('/login')
			} else {
				res.render('spa/note-viewer', { noteName: noteObj.title, noteContent: noteObj.content, createdOn: "etst-1", id: req.params.id })
			}
		} else {
			res.render('spa/note-viewer', { noteName: noteObj.title, noteContent: noteObj.content, createdOn: "etst-1", id: req.params.id })
		}
	} catch (e) {
		throw new Error(e)
	}
})

app.get("/notes/edit/:id", async (req, res) => {
	try {
		if (!req.user || req.isUnauthenticated()) {
			return res.redirect("/login")
		}

		const data = await Note.findOne({ id: req.params.id })
		res.render('spa/editor', { noteName: data.title, noteContent: data.content, user: req.user, noteId: req.params.id })

		console.log("new edit")
	} catch (error) {
		throw new Error(error)
	}
})
app.post("/notes/edit/:id", async (req, res) => {
	try {
		const conten1 = req.body.noteContent.replace(new RegExp('\r?\n', 'g'), '<br />');

		const data = await Note.findOneAndUpdate({ id: req.params.id })
		data.title = req.body.noteTitle;
		data.content = conten1;
		data.public = false;
		data.save();
		return res.redirect(`/notes/${req.params.id}`)
	} catch (e) {
		throw new Error(e)
	}
})

app.get("/notes/delete/:id", async (req, res) => {
	try {
		const note = await Note.deleteOne({ id: req.params.id })
		res.render('spa/deleted', { noteName: req.params.id })
	} catch (error) {
		throw new Error(error)
	}
})

// Media Manager
app.get("/media/:userid/:mediatype/:filename", async (req, res) => {
	res.sendFile(Path.join(__dirname, 'storage/', req.params.userid, req.params.mediatype, req.params.filename))
})

app.get("/login", async (req, res) => {
	if (req.isAuthenticated()) {
		res.send("No need to log in again! You're already logged in and authenticated.")
	} else {
		res.render('login')
	}
})
// app.get("/register", async (req, res) => {
// 	if (req.isAuthenticated()) {
// 		res.redirect("/")
// 	} else {
// 		res.render('register')
// 	}
// })
// app.get("/account", ensureAuth, async (req, res) => {
// 	res.render('account', { user: req.user })
// })
app.get("/logout", async function (req, res) {
	req.logout(function (err) {
		if (err) { return next(err); }
		res.render('logout.ejs')
	});
})

// app.post("/register", async (req, res) => {
// 	var email = req.body.username;
// 	var password = req.body.password;
// 	var inviteToken = "catzwiththebeanz";

// 	if (req.body.inviteToken !== inviteToken) {
// 		return res.send("Invalid Invite Token")
// 	} else {
// 		User.register({ username: email }, req.body.password, function (err, user) {
// 			if (err) {
// 				console.log(err)
// 			} else {
// 				Passport.authenticate("local")(req, res, function () {
// 					res.send("Saved successfully!")
// 				})
// 			}
// 		})
// 	}
// })
// app.post("/login", async (req, res) => {
// 	const userToBeChecked = new User({
// 		email: req.body.username,
// 		password: req.body.password,
// 	})

// 	req.login(userToBeChecked, function (err) {
// 		if (err) {
// 			console.log(err)
// 			res.redirect("/login")
// 		} else {
// 			Passport.authenticate("local")(req, res, function () {
// 				try {
// 					const newUser = User.find({ email: req.user.username })
// 					res.send("Logged in!")
// 				} catch (error) {
// 					throw new Error(error)
// 				}
// 			})
// 		}

// 	})
// })

app.use(Sentry.Handlers.errorHandler());
app.use(function onError(err, req, res, next) {
	res.statusCode = 500;
	res.end(res.sentry + "\n");
	console.log(err)
});


app.listen(port, () => {
	console.log("Server is live on port ", port)
})

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
