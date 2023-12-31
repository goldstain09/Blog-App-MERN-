const express = require("express");
const postRouter = express.Router();
const postController = require("../Controller/Post");
const { auth } = require("../Middleware/User.Auth");

postRouter
  .post("/PostaBlog", auth, postController.postBlog)
  .get("/getPostData/:postId", auth, postController.getPostData)
  .get("/getPostDataForCardOnly/:postId",postController.getPostDataForCardOnly)
  .put("/updateBlog", auth, postController.updateBlog)
  .delete("/deleteBlog/:postId", auth, postController.deleteBlog)
  .get("/getAllPosts", auth, postController.getAllPosts)
  .put("/likePost", auth, postController.likePost)
  .put("/unlikePost", auth, postController.unlikePost)
  .put("/savePost", auth, postController.savePost)
  .put("/unsavePost", auth, postController.unsavePost)
  
  .put('/postComment',auth,postController.postComment)
  .put('/deleteComment',auth,postController.deleteComment);

exports.postRoutes = postRouter;
