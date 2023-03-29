const Express = require('express');
const Passport = require('passport');
const Mongoose = require('mongoose');
const Session = require('express-session');
const PassportLocalMongoose = require('passport-local-mongoose');
const GitHubStrategy = require('passport-github2').Strategy;
const DiscordStrategy = require('passport-discord').Strategy;
const Refresh = require('passport-oauth2-refresh');

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
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs')

app.use(Session({
	secret: "4Jp*9Z9wbaVGHjAJ7K3Q&&5pcF#*mVWHG$%z!26Efm8P$SGqjym**wHNG8*#8NdXfc@C3@WQ4E9qxPPDNfjD5apv2S%qoPcQb&J4Mv*o^PorYVfe^is^eb^cQo%4d5Vi",
	resave: false,
	saveUninitialized: false
}));

app.use(Passport.initialize());
app.use(Passport.session());

Mongoose.connect('mongodb+srv://appauth:9RqaUNNVkyRwI2ch@cluster0.nxldnrc.mongodb.net/?retryWrites=true&w=majority', {
	useNewUrlParser: true,
	useUnifiedTopology: true
})

const userSchema = new Mongoose.Schema({
	email: String,
	password: String
})
userSchema.plugin(PassportLocalMongoose);

const User = new Mongoose.model("UserAuthTable", userSchema);
Passport.use(User.createStrategy());

Passport.use(new GitHubStrategy({
    clientID: config['github-oauth'].client_id,
    clientSecret: config['github-oauth'].client_secret,
    callbackURL: "https://4000-whizbangpop-notez-7nlvxcr62ga.ws-eu92.gitpod.io/auth/github/callback"
  },
  function(accessToken, refreshToken, profile, done) {
    process.nextTick(function () {
      return done(null, profile);
    });
  }
));

const discordStrat = new DiscordStrategy({
	clientID: config['discord-oauth'].client_id,
	clientSecret: config['discord-oauth'].client_secret,
	callbackURL: "https://4000-whizbangpop-notez-7nlvxcr62ga.ws-eu92.gitpod.io/auth/discord/callback",
	scope: ['identify', 'email']
  },
  function(accessToken, refreshToken, profile, done) {
	process.nextTick(function() {
		profile.refreshToken = refreshToken
        return done(null, profile);
    });
  })
Passport.use(discordStrat)
Refresh.use(discordStrat)

Passport.serializeUser(function(user, done) {
	done(null, user);
});
  
Passport.deserializeUser(function(obj, done) {
	done(null, obj);
});

app.get("/auth/github", Passport.authenticate('github', { scope: ['user:email'] }), function (req, res) {});
app.get("/auth/github/callback", Passport.authenticate('github', { failureRedirect: '/login' }), function (req, res) {
	res.redirect('/')
})

app.get("/auth/discord", Passport.authenticate('discord'));
app.get("/auth/discord/callback", Passport.authenticate('discord', { failureRedirect: "/login" }), function (req, res) {
	res.redirect('/')
})

app.get("/", ensureAuth, async (req, res) => {
	res.render('index', {user: req.user})
})
app.get("/notes", ensureAuth, async (req, res) => {
	res.render('notes', { user: req.user })
})

app.get("/login", async (req, res) => {
	if (req.isAuthenticated()) {
		res.send("No need to log in again! You're already logged in and authenticated.")
	} else {
		res.render('login')
	}
})
app.get("/register", async (req, res) => {
	if (req.isAuthenticated()) {
		res.redirect("/")
	} else {
		res.render('register')
	}
})
app.get("/account", ensureAuth, async (req, res) => {
	res.render('account', { user: req.user })
})
app.get("/logout", async function(req, res) {
	req.logout(function(err) {
		if (err) { return next(err); }
		res.render('logout.ejs')
	});
})

app.post("/register", async (req, res) => {
	var email = req.body.username;
	var password = req.body.password;
	var inviteToken = "catzwiththebeanz";

	if (req.body.inviteToken !== inviteToken) {
		return res.send("Invalid Invite Token")
	} else {
		User.register({ username: email }, req.body.password, function(err, user) {
			if (err) {
				console.log(err)
			} else {
				Passport.authenticate("local")(req, res, function() {
					res.send("Saved successfully!")
				})
			}
		})
	}
})
app.post("/login", async (req, res) => {
	const userToBeChecked = new User({
		email: req.body.username,
	 	password: req.body.password,
	})

	req.login(userToBeChecked, function (err) {
		if (err) {
			console.log(err)
			res.redirect("/login")
		} else {
			Passport.authenticate("local")(req, res, function() {
				try {
					const newUser = User.find({ email: req.user.username })
					res.send("Logged in!")
				} catch (error) {
					throw new Error(error)
				}
			})
		}
		
	})
})

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

		if (req.isAuthenticated()) { return next();  }
		else res.redirect('/login')
	} catch (error) {
		if (req.isAuthenticated()) { return next();  }
		else res.redirect('/login')
	}
	
}