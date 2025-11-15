import { Request, Response } from "express";
import { User } from "../Models/User";
import { generateToken } from "../utils/generateToken";
import { UserSettings } from "../Models/userSettings";

const handleOAuthCallback = async (req: Request, res: Response) => {
  if (!req.authData) {
    return res.redirect(
      `${process.env.FRONTEND_URL || "http://localhost:3000"}/login?error=${encodeURIComponent("Authentication failed")}`
    );
  }

  const { profile, provider } = req.authData;
  const redirectBase = process.env.FRONTEND_URL || "http://localhost:3000";
  let intent = "login";
  let successRedirect = "oauth-success";
  let from;
  try {
    if (req.query.state) {
      const decoded = JSON.parse(Buffer.from(req.query.state as string, "base64").toString());
      intent = decoded.intent || "login";
      from = decoded.from || undefined; 
      successRedirect = decoded.redirectUrl || "oauth-success";
      
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
      if (existingUser) {
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

      const newUser = await User.create({
        username: profile.name,
        email: profile.email,
        providerId: profile.id,
        provider: provider,
      });

      const userSettings = new UserSettings({
            userId: newUser._id,
          });
          await userSettings.save();

      return res.redirect(`${redirectBase}/login?success=${encodeURIComponent("Account created successfully! Please log in.")}&registered=true`);

    } else {
      if (!existingUser) {
        return res.redirect(
          `${redirectBase}/register?error=${encodeURIComponent(
            "No account found with this email. Please register first."
          )}&suggest=register`
        );
      }

      if (existingUser.provider !== provider) {
        return res.redirect(
          `${redirectBase}/login?error=${encodeURIComponent(
            `This email is registered with ${existingUser.provider || "another method"}. Please use that method to sign in.`
          )}`
        );
      }

      const token = generateToken({
        userId: existingUser._id,
        email: existingUser.email,
      });

      const params = new URLSearchParams({
    token,
    type: 'login',
    id: existingUser._id.toString(),
  name: existingUser.username || '',
  email: existingUser.email,
  avatar: existingUser.avatar || '',
});

if (from) {
  params.append('from', from);
}

  return res.redirect(`${redirectBase}/${successRedirect}?${params.toString()}`);
    }

  } catch (error) {
    console.error("OAuth error:", error);
    
    const redirectPage = intent === "register" ? "register" : "login";
    return res.redirect(
      `${redirectBase}/${redirectPage}?error=${encodeURIComponent(
        "Authentication failed. Please try again."
      )}`
    );
  }
};

export const generateOAuthState = (intent: "login" | "register", redirectUrl?: string, from?: string) => {
  const state: any = {
    intent,
    redirectUrl: redirectUrl || "oauth-success",
    timestamp: Date.now()
  };
  if (from) {
    state.from = from;
  }
  return Buffer.from(JSON.stringify(state)).toString("base64");
};

export const initiateGoogleOAuth = (intent: "login" | "register") => {
  return (req: Request, res: Response, next: any) => {
    const state = generateOAuthState(intent, req.query.redirect as string);
    req.query.state = state;
    next();
  };
};

export default handleOAuthCallback;