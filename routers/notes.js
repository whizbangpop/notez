const { Router } = require('express');
const router = Router();

router.get('/new', ensureAuth, async (req, res) => {
    res.send("test")
})

module.exports = router;

function ensureAuth(req, res, next) {
    try {
        if (!allowedUsers.includes(req.user.id)) {
            return res.redirect('../logout')
        }

        if (req.isAuthenticated()) { return next(); }
        else res.redirect('../login')
    } catch (error) {
        if (req.isAuthenticated()) { return next(); }
        else res.redirect('../login')
    }

}