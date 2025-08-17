import { Request, Response } from "express";
import { User } from "../Models/User";
import { generateToken } from "../utils/generateToken";

const handleOAuthCallback = async (req: Request, res: Response) => {
  if (!req.authData) {
    return res.redirect(
      `${process.env.FRONTEND_URL || "http://localhost:3000"}/login?error=${encodeURIComponent("Authentication failed")}`
    );
  }

  const { profile, provider } = req.authData;
  const redirectBase = process.env.FRONTEND_URL || "http://localhost:3000";
  let intent = "login"; // Default to login
  let successRedirect = "oauth-success";

  // Parse state parameter to get intent
  try {
    if (req.query.state) {
      const decoded = JSON.parse(Buffer.from(req.query.state as string, "base64").toString());
      intent = decoded.intent || "login";
      successRedirect = decoded.redirectUrl || "oauth-success";
      
      // Check if state is expired (20 minutes)
      const timestamp = decoded.timestamp;
      if (timestamp && Date.now() - timestamp > 20 * 60 * 1000) {
        throw new Error("State parameter expired");
      }
    }
  } catch (error) {
    console.warn("Could not decode state parameter:", error);
    return res.redirect(
      `${redirectBase}/login?error=${encodeURIComponent("Invalid authentication state")}`
    );
  }

  try {
    const existingUser = await User.findOne({ email: profile.email });

    if (intent === "register") {
      // REGISTRATION FLOW
      if (existingUser) {
        // User already exists, can't register again
        if (existingUser.provider !== provider) {
          return res.redirect(
            `${redirectBase}/register?error=${encodeURIComponent(
              `Email already registered with ${existingUser.provider || "another method"}. Try logging in instead.`
            )}&suggest=login`
          );
        } else {
          return res.redirect(
            `${redirectBase}/register?error=${encodeURIComponent(
              "Account already exists with this email. Please sign in instead."
            )}&suggest=login`
          );
        }
      }

      // Create new user (registration)
      const newUser = await User.create({
        name: profile.name,
        email: profile.email,
        providerId: profile.id,
        provider: provider,
        // Add any other fields you need for new users
      });

      const token = generateToken({
        userId: newUser._id,
        email: newUser.email,
      });

      // Redirect to success page after successful registration
      return res.redirect(
        `${redirectBase}/${successRedirect}?token=${token}&type=register&id=${newUser._id}&name=${encodeURIComponent(
          newUser.name || ""
        )}&email=${encodeURIComponent(newUser.email)}&new=true`
      );

    } else {
      // LOGIN FLOW
      if (!existingUser) {
        // User doesn't exist, can't login
        return res.redirect(
          `${redirectBase}/login?error=${encodeURIComponent(
            "No account found with this email. Please register first."
          )}&suggest=register`
        );
      }

      // Check if provider matches
      if (existingUser.provider !== provider) {
        return res.redirect(
          `${redirectBase}/login?error=${encodeURIComponent(
            `This email is registered with ${existingUser.provider || "another method"}. Please use that method to sign in.`
          )}`
        );
      }

      // Successful login
      const token = generateToken({
        userId: existingUser._id,
        email: existingUser.email,
      });

      return res.redirect(
        `${redirectBase}/${successRedirect}?token=${token}&type=login&id=${existingUser._id}&name=${encodeURIComponent(
          existingUser.name || ""
        )}&email=${encodeURIComponent(existingUser.email)}`
      );
    }

  } catch (error) {
    console.error("OAuth error:", error);
    
    // Redirect to appropriate page based on intent
    const redirectPage = intent === "register" ? "register" : "login";
    return res.redirect(
      `${redirectBase}/${redirectPage}?error=${encodeURIComponent(
        "Authentication failed. Please try again."
      )}`
    );
  }
};

// Helper function to generate state parameter for OAuth URLs
export const generateOAuthState = (intent: "login" | "register", redirectUrl?: string) => {
  const state = {
    intent,
    redirectUrl: redirectUrl || "oauth-success",
    timestamp: Date.now()
  };
  return Buffer.from(JSON.stringify(state)).toString("base64");
};

// Example usage in your OAuth routes
export const initiateGoogleOAuth = (intent: "login" | "register") => {
  return (req: Request, res: Response, next: any) => {
    const state = generateOAuthState(intent, req.query.redirect as string);
    // Add state to your passport authenticate call
    req.query.state = state;
    next();
  };
};

export default handleOAuthCallback;