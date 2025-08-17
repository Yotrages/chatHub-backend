import { Request, Response } from "express";
import { User } from "../Models/User";
import { generateToken } from "../utils/generateToken";

const handleOAuthCallback = async (req: Request, res: Response) => {
  if (!req.authData) {
    return res.redirect(
      `http://localhost:3000/register?error=${encodeURIComponent("Authentication data missing")}`
    );
  }

  const { profile, provider } = req.authData;
  const redirectBase = "http://localhost:3000";
  let intent = "register"; 
  let successRedirect = "oauth-success";

  try {
    if (req.query.state) {
      const decoded = JSON.parse(Buffer.from(req.query.state as string, "base64").toString());
      intent = decoded.intent || "register"; 
      successRedirect = decoded.redirectUrl || "oauth-success";
      const timestamp = decoded.timestamp;
      if (timestamp && Date.now() - timestamp > 20 * 60 * 1000) {
        throw new Error("State parameter expired");
      }
    }
  } catch (error) {
    console.warn("Could not decode state parameter:", error);
    return res.redirect(
      `${redirectBase}/register?error=${encodeURIComponent("Invalid authentication state")}`
    );
  }

  try {
    const existingUser = await User.findOne({ email: profile.email });

    if (existingUser) {
      // User exists
      if (existingUser.provider !== provider) {
        const errorMsg = `Email already used with ${existingUser.provider || "another method"}`;
        return res.redirect(
          `${redirectBase}/${intent === "register" ? "register" : "login"}?error=${encodeURIComponent(
            errorMsg
          )}`
        );
      }

      if (intent === "register") {
        // User tried to register but account exists
        return res.redirect(
          `${redirectBase}/register?error=${encodeURIComponent(
            "An account with this email already exists. Please sign in instead."
          )}&suggest=login`
        );
      }

      // Login flow
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

    // No user exists, proceed with registration
    const newUser = await User.create({
      name: profile.name,
      email: profile.email,
      providerId: profile.id,
      provider: provider,
    //   username: profile.email.split("@")[0], // Generate a default username
    });

    const token = generateToken({
      userId: newUser._id,
      email: newUser.email,
    });

    return res.redirect(
      `${redirectBase}/login?token=${token}&type=register&id=${newUser._id}&name=${encodeURIComponent(
        newUser.name || ""
      )}&email=${encodeURIComponent(newUser.email)}`
    );
  } catch (error) {
    console.error("OAuth error:", error);
    const errorMsg = "OAuth authentication failed. Please try again.";
    return res.redirect(
      `${redirectBase}/${intent === "register" ? "register" : "login"}?error=${encodeURIComponent(errorMsg)}`
    );
  }
};

export default handleOAuthCallback;