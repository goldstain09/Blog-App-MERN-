// modals
const postModel = require("../Model/Post");
const userModel = require("../Model/User");
const User = userModel.User;
const Post = postModel.Post;

// otp verification
const otpGenerator = require("otp-generator");
// mail sender
const nodemailer = require("nodemailer");

const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const util = require("util");
// i did this with the help of chat gpt
// because these genSalt and hash function didnot return promises they use callbacks
// so i use this because I'm not able to use await in that callback
// and use of await is required to save()  data to db...
const genSalt = util.promisify(bcrypt.genSalt);
const hashAsync = util.promisify(bcrypt.hash);

//keys
const privateKey = process.env.PRIVATE_KEY;
const publicKey = process.env.PUBLIC_KEY;

exports.createNewUser = async (req, res) => {
  const { userName, Name, Password } = req.body;
  try {
    const userToken = jwt.sign(
      { user: { userName: userName, Name: Name } },
      privateKey,
      { algorithm: "RS256", expiresIn: `1h` }
    );
    const user = new User(req.body);
    user.jwToken = userToken;
    user.Name = Name;
    user.userName = userName;
    const SaltRounds = 14;
    const salt = await genSalt(SaltRounds);
    const hashPas = await hashAsync(Password, salt);
    if (hashPas) {
      user.Password = hashPas;
      await user.save();
      delete user.Password;
      res.json({ data: user, userCreated: true });
    }
  } catch (error) {
    if (error.hasOwnProperty("code") && error.hasOwnProperty("keyValue")) {
      if (error.code === 11000) {
        res.json({
          userCreated: false,
          userNameIsUnique: false,
        });
      }
    } else {
      res.json({
        errorMessage: error,
        userCreated: false,
      });
    }
  }
};

exports.verifyUserAuth = async (req, res) => {
  const userData = req.userData;
  const newUserToken = req.newUserToken;
  try {
    const user = await User.findOne({ userName: userData.user.userName });
    delete user.Password;
    await User.findByIdAndUpdate(user._id, { $set: { jwToken: newUserToken } });
    user.jwToken = newUserToken;
    res.json({
      data: user,
      verification: true,
    });
  } catch (error) {
    res.json({
      verification: false,
      errorMessage: error.message,
    });
  }
};

exports.loginUser = async (req, res) => {
  const { userName, Password } = req.body;
  try {
    const user = await User.findOne({ userName: userName });
    if (user) {
      // i take help from chat gpt here because i want to update jwtoken in database also, with response
      // and inside compare function using await is giving error!!!!
      const result = await new Promise((resolve, reject) => {
        bcrypt.compare(Password, user.Password, (err, result) => {
          if (err) {
            throw Error(`Unable to login! ${err.message}`);
          } else {
            resolve(result);
          }
        });
      });
      if (result) {
        // first signing a new token
        const newUserToken = jwt.sign(
          { user: { userName: user.userName, Name: user.Name } },
          privateKey,
          { algorithm: "RS256", expiresIn: `1h` }
        );
        // now update that token in database
        await User.findByIdAndUpdate(user._id, {
          $set: { jwToken: newUserToken },
        });
        user.jwToken = newUserToken;
        delete user.Password;
        res.json({
          data: user,
          userLoginSuccess: true,
        });
      } else {
        res.json({
          PasswordIsWrong: true,
          userLoginSuccess: false,
        });
      }
    } else {
      res.json({
        userNameIsWrong: true,
        userLoginSuccess: false,
      });
    }
  } catch (error) {
    res.json({
      userLoginSuccess: false,
      errorMessage: error.message,
    });
  }
};

exports.checkUsernameAvailablity = async (req, res) => {
  const { userName } = req.params;
  try {
    const user = await User.findOne({ userName: userName });
    if (user) {
      res.json(false);
    } else {
      res.json(true);
    }
  } catch (error) {
    res.json({ someErrorOccured: error.message });
  }
};

exports.editUser = async (req, res) => {
  const { Name, userName, profilePicture, Biography } = req.body; // new data which user wants to update
  const userData = req.userData.user; // old data which is get by token
  try {
    const user = await User.findOne({ userName: userData.userName });
    // i m using auth middlewares newly created token but then i realised that token made with old name and username that will make problem in
    // future -- so i created a new token here with new info---
    const newUserToken = jwt.sign(
      { user: { userName: userName, Name: Name } },
      privateKey,
      { algorithm: "RS256", expiresIn: `1h` }
    );
    // also updating new username in my posts so that post didnot show older username or profile picture
    await Post.updateMany(
      { userId: user._id },
      { $set: { userName: userName } }
    );
    await Post.updateMany(
      { userId: user._id },
      { $set: { userProfilePicture: profilePicture } }
    ); // these two steps added after created posts !!
    // here is update ones fields
    const updateFields = {
      userName: userName,
      Name: Name,
      profilePicture: profilePicture,
      Biography: Biography,
      jwToken: newUserToken,
    };
    const UpdatedUser = await User.findByIdAndUpdate(user._id, updateFields, {
      new: true,
    });
    const userr = { ...UpdatedUser };
    (userr._doc.updated = "true"), delete userr._doc.Password;
    res.json({
      data: userr._doc,
      userUpdated: true,
    });
  } catch (error) {
    res.json({
      userUpdated: false,
      errorMessage: error.Message,
    });
  }
};

exports.AddEmailOtpVerification = async (req, res) => {
  // const userData = req.userData.user;
  const newUserToken = req.newUserToken;
  const email = req.params.email;

  try {
    const generateOTP = () => {
      return otpGenerator.generate(6, {
        upperCase: false,
        specialChars: false,
        alphabets: false,
        digits: true,
        length: 6,
        secret: true,
        expiration: 300,
        characters: "0123456789",
      });
    };
    const otp = generateOTP();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL,
        pass: process.env.PASSWORD,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL,
      to: email,
      subject: "Bloggo Basho's Email Verification OTP",
      html: `<h1>Your OTP is: ${otp}</h1>`,
    };
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        throw Error(error.message);
      } else {
        res.json({
          message: "OTP is sent!",
          OtpSent: true,
          otpInfo: { otp: otp, info: info },
          jwToken: newUserToken,
        });
      }
    });
  } catch (error) {
    res.json({
      message: "Something went wrong, Please try again after sometime!",
      OtpSent: false,
      errorMessage: error.message,
    });
  }
};

exports.addUserEmail = async (req, res) => {
  const userData = req.userData.user;
  const newUserToken = req.newUserToken;
  const email = req.body.Email;
  try {
    const user = await User.findOne({ userName: userData.userName });
    const updateData = {
      Email: email,
      jwToken: newUserToken,
    };
    const UpdatedUser = await User.findByIdAndUpdate(user._id, updateData, {
      new: true,
    }); // {$set:{Email:email}}
    const userr = { ...UpdatedUser };
    (userr._doc.emailUpdated = "true"), delete userr._doc.Password;
    res.json({
      data: userr._doc,
      emailUpdated: true,
    });
  } catch (error) {
    res.json({
      errorMessage: error.message,
      emailUpdated: false,
    });
  }
};

exports.removeUserEmail = async (req, res) => {
  const userData = req.userData.user;
  const newUserToken = req.newUserToken;
  try {
    const user = await User.findOne({ userName: userData.userName });
    const updateData = {
      Email: "",
      jwToken: newUserToken,
    };
    const UpdatedUser = await User.findByIdAndUpdate(user._id, updateData, {
      new: true,
    });
    const Userr = { ...UpdatedUser };
    delete Userr._doc.Password;
    res.json({
      data: Userr._doc,
      emailDeleted: true,
    });
  } catch (error) {
    res.json({
      emailDeleted: false,
      errorMessage: error.message,
    });
  }
};

exports.changePassword = async (req, res) => {
  const userData = req.userData.user;
  const newUserToken = req.newUserToken;
  const { currentPassword, newPassword } = req.body;
  try {
    const user = await User.findOne({ userName: userData.userName });
    const result = await new Promise((resolve, reject) => {
      bcrypt.compare(currentPassword, user.Password, (err, result) => {
        if (err) {
          throw Error("Something went wrong! " + err.message);
        } else {
          resolve(result);
        }
      });
    });
    if (result) {
      const SaltRounds = 14;
      const salt = await genSalt(SaltRounds);
      const hashPas = await hashAsync(newPassword, salt);
      if (hashPas) {
        const updateData = {
          jwToken: newUserToken,
          Password: hashPas,
        };
        const updatedUser = await User.findByIdAndUpdate(user._id, updateData, {
          new: true,
        });
        const userr = { ...updatedUser };
        delete userr._doc.Password;
        userr._doc.passwordUpdated = "true";
        res.json({
          data: userr._doc,
          passwordUpdated: true,
        });
      }
    } else {
      const userr = { ...user };
      userr._doc.wrongPassword = "true";
      delete userr._doc.Password;
      res.json({
        data: userr._doc,
        passwordUpdated: false,
        wrongPassword: true,
      });
    }
  } catch (error) {
    res.json({
      passwordUpdated: false,
      errorMessage: error.message,
    });
  }
};

exports.changePasswordOtpVerification = async (req, res) => {
  const email = req.params.email;
  // const userData = req.userData.user;
  const newUserToken = req.newUserToken;
  try {
    const generateOTP = () => {
      return otpGenerator.generate(6, {
        upperCase: false,
        specialChars: false,
        alphabets: false,
        digits: true,
        length: 6,
        secret: true,
        expiration: 300,
        characters: "0123456789",
      });
    };
    const otp = generateOTP();
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL,
        pass: process.env.PASSWORD,
      },
    });
    const mailOptions = {
      from: process.env.EMAIL,
      to: email,
      subject: "Bloggo Basho's OTP Verification for Resetting Password!",
      html: `<h1>Your OTP is ${otp} [for changing password]</h1>`,
    };
    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        throw Error(err.message);
      } else {
        res.json({
          otpInfo: { otp: otp, info: info },
          otpSent: true,
          message: "OTP is sent!",
          jwToken: newUserToken,
        });
      }
    });
  } catch (error) {
    res.json({
      errorMessage: error.message,
      otpSent: false,
      message: "Something went wrong!",
    });
  }
};

exports.forgetChangeUserPassword = async (req, res) => {
  const userData = req.userData.user;
  const newUserToken = req.newUserToken;
  const newPassword = req.body.newPassword;
  try {
    const user = await User.findOne({ userName: userData.userName });
    const SaltRounds = 14;
    const salt = await genSalt(SaltRounds);
    const hashPas = await hashAsync(newPassword, salt);
    if (hashPas) {
      const updateData = {
        jwToken: newUserToken,
        Password: hashPas,
      };
      const UpdatedUser = await User.findByIdAndUpdate(user._id, updateData, {
        new: true,
      });
      const userr = { ...UpdatedUser };
      delete userr._doc.Password;
      userr._doc.forgetPasswordUpdated = "true";
      res.json({
        passwordUpdated: true,
        data: userr._doc,
      });
    }
  } catch (error) {
    res.json({
      passwordUpdated: false,
      errorMessage: error.message,
    });
  }
};

exports.checkPasswordForDeleteAccount = async (req, res) => {
  const userData = req.userData.user;
  // const newUserToken = req.newUserToken;
  const password = req.body.password;
  try {
    const user = await User.findOne({ userName: userData.userName });

    const result = await new Promise((resolve, reject) => {
      bcrypt.compare(password, user.Password, (err, resultt) => {
        if (err) {
          throw Error("Something went wrong! " + err.message);
        } else {
          resolve(resultt);
        }
      });
    });
    if (result) {
      // const UpdatedUser = await User.findByIdAndUpdate(user._id,{$set:{jwToken:newUserToken}}, {new:true});
      // here i didn't update new token and also didn't sent it to response-- only use auth middleware for user info!!

      // also one more thing that why im using ... operator here, it's bczz i'm not able to direclty delete password property in "user" so that's why
      // i take all values from user to userr and then delete password !
      const userr = { ...user };
      delete userr._doc.Password;
      userr._doc.passwordCorrect = "true";
      res.json({
        data: userr._doc,
        passwordCorrect: true,
      });
    } else {
      const userr = { ...user };
      delete userr._doc.Password;
      userr._doc.passwordIncorrect = "true";
      res.json({
        data: userr._doc,
        passwordCorrect: false,
      });
    }
  } catch (error) {
    res.json({
      passwordCorrect: false,
      errorMessage: error.message,
    });
  }
};

exports.deleteUserAccount = async (req, res) => {
  const userData = req.userData.user;
  try {
    // all posts of this user
    const allPosts = await Post.deleteMany({ userName: userData.userName });
    // console.log(allPosts);
    const user = await User.findOneAndDelete({ userName: userData.userName });
    const userr = { ...user };
    delete userr._doc.Password;
    userr._doc.accountDeleted = "true";
    res.json({
      accountDeleted: true,
      data: userr._doc,
    });
  } catch (error) {
    res.json({
      accountDeleted: false,
      errorMessage: error.message,
    });
  }
};

exports.getBloggerData = async (req, res) => {
  const bloggerId = req.query.bloggerId;
  try {
    const blogger = await User.findById(bloggerId);
    const bloggerData = { ...blogger };
    delete bloggerData._doc.Password;
    delete bloggerData._doc.Email;
    delete bloggerData._doc.likedPost;
    delete bloggerData._doc.savedPost;
    delete bloggerData._doc.jwToken;
    delete bloggerData._doc.createdAt;
    res.json({
      bloggerData: bloggerData._doc,
    });
  } catch (error) {
    res.json({
      errorMessage: error.message,
    });
  }
};

// function for only showing user data to the comments
exports.getUserUserNameAndDp = async (req, res) => {
  const userId = req.params.userId;
  try {
    const user = await User.findById(userId);
    res.json({
      profilePicture: user.profilePicture,
      userName: user.userName,
    });
  } catch (error) {
    res.json({
      errorMessage: error.message,
    });
  }
};

// to follow blogger
exports.followBlogger = async (req, res) => {
  const userData = req.userData.user;
  const { bloggerId } = req.body;
  try {
    // user who is following blogger
    const user = await User.findOne({ userName: userData.userName });

    // the blogger
    const blogger = await User.findById(bloggerId);

    if (
      user.Followings.every((item) => item.bloggerId !== bloggerId) &&
      blogger.Followers.every((item) => item.bloggerId !== user._id)
    ) {
      user.Followings.push({
        bloggerId: bloggerId,
      });

      blogger.Followers.push({
        bloggerId: user._id.toString(),
      });

      const updatedUser = await User.findByIdAndUpdate(
        user._id,
        { $set: { Followings: user.Followings } },
        { new: true }
      );
      const userr = { ...updatedUser };
      delete userr._doc.Password;
      const updatedBlogger = await User.findByIdAndUpdate(
        bloggerId,
        { $set: { Followers: blogger.Followers } },
        { new: true }
      );
      const bloggerr = { ...updatedBlogger };
      delete bloggerr._doc.Password;
      delete bloggerr._doc.Email;
      delete bloggerr._doc.likedPost;
      delete bloggerr._doc.savedPost;
      delete bloggerr._doc.jwToken;
      delete bloggerr._doc.createdAt;
      res.json({
        userData: userr._doc,
        bloggerData: bloggerr._doc,
        followed: true,
      });
    }
  } catch (error) {
    res.json({
      errorMessage: error.message,
      followed: false,
    });
  }
};

exports.unfollowBlogger = async (req, res) => {
  const userData = req.userData.user;
  const { bloggerId } = req.body;
  try {
    const user = await User.findOne({ userName: userData.userName });
    const blogger = await User.findById(bloggerId);

    if (
      user.Followings.every((item) => item.bloggerId !== bloggerId) &&
      blogger.Followers.every((item) => item.bloggerId !== user._id)
    ) {
    } else {
      const updatedFollowingOfUser = user.Followings.filter(
        (item) => item.bloggerId !== bloggerId
      );
      const updatedFollowersOfBlogger = blogger.Followers.filter(
        (item) => item.bloggerId !== user._id.toString()
      );

      const updatedUser = await User.findByIdAndUpdate(
        user._id,
        { $set: { Followings: updatedFollowingOfUser } },
        { new: true }
      );
      const userr = { ...updatedUser };
      delete userr._doc.Password;
      const updatedBlogger = await User.findByIdAndUpdate(
        bloggerId,
        { $set: { Followers: updatedFollowersOfBlogger } },
        { new: true }
      );
      const bloggerr = { ...updatedBlogger };
      delete bloggerr._doc.Password;
      delete bloggerr._doc.Email;
      delete bloggerr._doc.likedPost;
      delete bloggerr._doc.savedPost;
      delete bloggerr._doc.jwToken;
      delete bloggerr._doc.createdAt;

      res.json({
        userData: userr._doc,
        bloggerData: bloggerr._doc,
        unfollowed: true,
      });
    }
  } catch (error) {
    res.json({
      errorMessage: error.message,
      unfollowed: false,
    });
  }
};

exports.getAllBloggersData = async (req, res) => {
  const userData = req.userData.user;
  try {
    const bloggersList = await User.find();
    const updatedBloggersWithoutMe = bloggersList.filter(
      (item) => item.userName !== userData.userName
    );
    // now removing imp info of users or bloggers
    updatedBloggersWithoutMe.map((item) => {
      const blogger = { ...item };
      delete blogger._doc.Password;
      delete blogger._doc.jwToken;
      delete blogger._doc.Email;
      delete blogger._doc.likedPost;
      delete blogger._doc.savedPost;
      delete blogger._doc.myPosts;
      delete blogger._doc.Followers;
      delete blogger._doc.Followings;
      delete blogger._doc.Biography;
      delete blogger._doc.createdAt;

      return blogger._doc;
    });
    // console.log(updatedBloggersWithoutMe);
    res.json({
      bloggersList: updatedBloggersWithoutMe,
      success: true,
    });
  } catch (error) {
    res.json({
      success: false,
      errorMessage: error.message,
    });
  }
};
