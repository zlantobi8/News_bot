import axios from "axios";
import { TwitterApi } from "twitter-api-v2";
import dotenv from "dotenv";
dotenv.config();

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

async function postTweetWithImage(tweetText, imageUrl) {
  try {
    // Download image as Buffer
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
      maxRedirects: 5,
    });
    const imageBuffer = Buffer.from(response.data, "binary");

    // Upload image to Twitter
    const mediaId = await twitterClient.v1.uploadMedia(imageBuffer, {
      mimeType: "image/jpeg",
    });

    // Post tweet with image
    const tweet = await twitterClient.v2.tweet({
      text: tweetText,
      media: { media_ids: [mediaId] },
    });

    console.log("✅ Tweet posted:", tweet.data.id);
  } catch (error) {
    console.error("❌ Twitter posting failed:", error);
  }
}

// Example test
postTweetWithImage(
  "📢 Breaking news test post",
  "https://images.seattletimes.com/wp-content/uploads/2025/10/10132025_tzr_tzr_1635.jpg"
);
