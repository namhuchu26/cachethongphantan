const jwt = require('jsonwebtoken');
const config = require('../config');
const { HttpError } = require('../errors');

// Đăng nhập đơn giản bằng tên: token JWT chứa tên người dùng (sub).
// Server nào cũng kiểm tra được token vì dùng chung JWT_SECRET → không cần session.
function requireUser(req, _res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Bạn cần đăng nhập'));
  try {
    req.userId = jwt.verify(token, config.jwtSecret).sub;
    next();
  } catch {
    next(new HttpError(401, 'Phiên đăng nhập không hợp lệ'));
  }
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '12h' });
}

module.exports = { requireUser, signToken };
