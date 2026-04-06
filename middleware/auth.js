const jwt = require('jsonwebtoken');
const User = require('../models/users');

const authenticateToken = async (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    
    if (!token) return res.status(401).json({ message: 'Access denied' });
    
    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
        if (err) return res.status(403).json({ message: 'Invalid token' });

        try {
            const user = await User.findById(decoded.id).select('-password');
            if (!user || !user.isActive || !user.isALive) {
                return res.status(403).json({ message: 'Account is deactivated' });
            }

            req.user = user; 
            next();
        } catch (error) {
            console.error('Auth middleware error:', error);
            res.status(500).json({ message: 'Server error' });
        }
    });
};

module.exports = { authenticateToken };
