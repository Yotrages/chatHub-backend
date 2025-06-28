import { User } from "../Models/User";
import { Request, Response } from "express";
import { generateToken } from "../utils/generateToken";

const handleOAuthCallback = async (req: Request, res: Response) => {
    if (!req.authData) {
        return res.redirect('http://localhost:5173/auth?error=' + encodeURIComponent('Authentication data missing'));
    }

    const { profile, provider } = req.authData; 
    
    let intent = 'login';
    let redirectBase = 'http://localhost:5173';
    let successRedirect = '/dashboard';
    
    try {
        if (req.query.state) {
            const decoded = JSON.parse(Buffer.from(req.query.state as string, 'base64').toString());
            intent = decoded.intent || 'login';
            successRedirect = decoded.redirectUrl || '/dashboard';
            
            const timestamp = decoded.timestamp;
            if (timestamp && (Date.now() - timestamp > 10 * 60 * 1000)) { // 10 minutes
                throw new Error('State parameter expired');
            }
        }
    } catch (error) {
        console.warn('Could not decode state parameter:', error);
        return res.redirect(`${redirectBase}/auth?error=${encodeURIComponent('Invalid authentication state')}`);
    }
  
    try {
        const existingUser = await User.findOne({ email: profile.email });
  
        if (existingUser) {
            if (existingUser.provider !== provider) {
                const errorMsg = `Email already used with ${existingUser.provider || 'another method'}`;
                return res.redirect(`${redirectBase}/auth?error=${encodeURIComponent(errorMsg)}`);
            }
  
            if (intent === 'register') {
                const errorMsg = 'An account with this email already exists. Please sign in instead.';
                return res.redirect(`${redirectBase}/auth?error=${encodeURIComponent(errorMsg)}&suggest=login`);
            } else {
                const token = generateToken({
                    userId: existingUser._id,
                    email: existingUser.email
                });
                return res.redirect(`${redirectBase}/auth/callback?token=${token}&type=login`);
            }
        }
  
        if (intent === 'login') {
            const errorMsg = 'No account found with this email. Please create an account first.';
            return res.redirect(`${redirectBase}/auth?error=${encodeURIComponent(errorMsg)}&suggest=register`);
        } else {
            const newUser = await User.create({
                name: profile.name,
                email: profile.email,
                providerId: profile.id,
                provider: provider,
            });
  
            const token = generateToken({
                userId: newUser._id,
                email: newUser.email
            });
            return res.redirect(`${redirectBase}/auth/callback?token=${token}&type=register`);
        }
        
    } catch (error) {
        console.error('OAuth error:', error);
        const errorMsg = 'OAuth authentication failed. Please try again.';
        return res.redirect(`${redirectBase}/auth?error=${encodeURIComponent(errorMsg)}`);
    }
};

export default handleOAuthCallback;