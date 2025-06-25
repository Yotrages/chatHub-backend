import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../Models/User';

interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  avatar: File | undefined;
}

interface LoginRequest {
  email: string;
  password: string | undefined;
}

export const register = async (req: Request<{}, {}, RegisterRequest>, res: Response): Promise<Response> => {
  try {
    const { username, email, password } = req.body;
    const avatar = req.file;

    console.log('Register request body:', req.body);
    console.log('Register request file:', req.file);

    // Validate required fields
    if (!username || !email || !password) {
      return res.status(400).json({ 
        error: 'Username, email, and password are required' 
      });
    }
    // if not file
    if (!req.file) {
      return res.status(400).json({ 
        error: 'image upload failed' 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        error: 'Invalid email format' 
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ 
        error: 'Password must be at least 6 characters long' 
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }]
    });
    
    if (existingUser) {
      const field = existingUser.email === email ? 'email' : 'username';
      return res.status(400).json({ 
        error: `User with this ${field} already exists` 
      });
    }

    // Check if JWT_SECRET exists
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not defined in environment variables');
      return res.status(500).json({ 
        error: 'Server configuration error' 
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Create user
    const user = new User({
      username,
      email,
      password: hashedPassword,
      online: false,
      avatar: avatar?.path || null,
      lastSeen: new Date()
    });
    
    console.log('Attempting to save user:', {
      username: user.username,
      email: user.email,
      avatar: user.avatar
    });

    const savedUser = await user.save();
    console.log('User saved successfully:', savedUser._id);
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: savedUser._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    return res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: savedUser._id,
        username: savedUser.username,
        email: savedUser.email,
        avatar: savedUser.avatar
      }
    });
    
  } catch (error: any) {
    console.error('Registration error:', error);
    
    // Handle specific MongoDB errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map((err: any) => err.message);
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: validationErrors 
      });
    }

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ 
        error: `${field} already exists` 
      });
    }

    return res.status(500).json({ 
      error: 'Server error during registration',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const login = async (req: Request<{}, {}, LoginRequest>, res: Response): Promise<Response> => {
  try {
    const { email, password } = req.body;

    console.log('Login request:', { email: email, passwordProvided: !!password });

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required' 
      });
    }

    // Check if JWT_SECRET exists
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not defined in environment variables');
      return res.status(500).json({ 
        error: 'Server configuration error' 
      });
    }
    
    // Find user
    const user = await User.findOne({ email: email });
    console.log('User found:', !!user);
    
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    if (!user.password) {
      return res.status(400).json({ error: 'user have no password' });
    }
    
    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    console.log('Password match:', isMatch);
    
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Update user online status
    user.online = true;
    await user.save();
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar
      }
    });
    
  } catch (error : any) {
    console.error('Login error:', error);
    return res.status(500).json({ 
      error: 'Server error during login',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const changePassword = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(404).json({ message: "All fields are required" });
  }

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ message: "Invalid email account" });
    }

    // Hash new password before updating
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await User.findOneAndUpdate(
      { email: user.email },
      { password: hashedPassword },
      { new: true }
    );

    return res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server Error", error });
  }
};

export const searchUser = async (req: Request, res: Response) => {
    const { query } = req.params;
    try {
      const user = await User.find({
      username: {$regex: query, $options: "i"}
    })
    if (user.length === 0) {
      return res.status(404).json({message: "User not found"})
    }
    return res.status(200).json(user)
    } catch (error) {
      res.status(500).json({ message: "Server Error"})
    }
}

export const getUsers = async (req: Request, res: Response) => {
  const userId = req.user?.userId
  try {
    const users = await User.find()
    const otherUsers = users.filter((user) => user._id !== userId)
    res.status(200).json(otherUsers)
  } catch (error: any) {
      console.log(error)
      res.status(500).json({message: "Server error"})
  }
}