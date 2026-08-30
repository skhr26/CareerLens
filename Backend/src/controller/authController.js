const bcrypt = require('bcrypt');
const userModel = require('../models/UserModel');
const blackListModel = require("../models/blacklist");
const jwt = require("jsonwebtoken");

async function register(req, res) {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({
      message: "Username, email, and password are required."
    });
  }

  const exist = await userModel.findOne({
    $or: [
      { username },
      { email }
    ]
  });

  if (exist) {
    return res.status(400).json({
      message: "You have already registered! Please go and login now."
    });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await userModel.create({
    username,
    email,
    password: hashedPassword
  });

  const token = jwt.sign({
    id: user._id,
    username: user.username
  }, process.env.JWT || "secret", { expiresIn: "1d" });

  res.cookie("token", token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 24 * 60 * 60 * 1000
  });

  res.status(201).json({
    message: "Registered successfully!",
    user: {
      username: user.username,
      email: user.email
    }
  });
}

async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      message: "Email and password are required."
    });
  }

  const user = await userModel.findOne({
    $or: [
      { email },
      { username: email }
    ]
  });

  if (!user || !user.password) {
    return res.status(401).json({
      message: "Invalid credentials."
    });
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    return res.status(401).json({
      message: "Invalid credentials."
    });
  }

  const token = jwt.sign({
    id: user._id,
    username: user.username
  }, process.env.JWT || "secret", { expiresIn: "1d" });

  res.cookie("token", token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 24 * 60 * 60 * 1000
  });

  res.status(200).json({
    message: "Logged in successfully",
    user: {
      username: user.username,
      email: user.email
    }
  });
}

const logout = async (req, res) => {
  const token = req.cookies.token;

  if (token) {
    await blackListModel.create({ token });
  }

  res.clearCookie("token", {
    httpOnly: true,
    secure: true,
    sameSite: "none"
  });

  return res.status(200).json({
    message: "Logout Successfully!",
  });
}

const getme = async (req, res) => {
  const { id } = req.user;

  const user = await userModel.findById(id);

  if (!user) {
    return res.status(404).json({
      message: "User not found!"
    });
  }

  res.status(200).json({
    message: "User found!",
    user: {
      id: user._id,
      username: user.username,
      email: user.email
    }
  });
}

module.exports = { register, login, logout, getme };