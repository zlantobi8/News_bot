import { createClient } from "@sanity/client";
import dotenv from "dotenv";
dotenv.config();

// Configure Sanity
const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: process.env.SANITY_DATASET,
  token: process.env.SANITY_TOKEN,
  useCdn: false,
  apiVersion: "2023-10-01",
});

async function deleteAllNews() {
  try {
    console.log("🗑️  Starting deletion process...\n");

    // Fetch all news documents
    const allNews = await client.fetch('*[_type == "news"]');
    
    if (allNews.length === 0) {
      console.log("✅ No news articles found. Database is already clean!");
      return;
    }

    console.log(`📊 Found ${allNews.length} news articles to delete\n`);
    console.log("⏳ Deleting...\n");

    let deletedCount = 0;
    let failedCount = 0;

    // Delete each document
    for (const article of allNews) {
      try {
        await client.delete(article._id);
        deletedCount++;
        console.log(`✅ Deleted [${deletedCount}/${allNews.length}]: ${article.title?.slice(0, 60)}...`);
      } catch (error) {
        failedCount++;
        console.error(`❌ Failed to delete: ${article.title?.slice(0, 60)}...`);
        console.error(`   Error: ${error.message}`);
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("\n📊 DELETION SUMMARY:");
    console.log(`   ✅ Successfully deleted: ${deletedCount}`);
    console.log(`   ❌ Failed: ${failedCount}`);
    console.log(`   📈 Total processed: ${allNews.length}\n`);
    
    if (deletedCount === allNews.length) {
      console.log("🎉 All news articles deleted successfully!\n");
    } else {
      console.log("⚠️  Some articles could not be deleted. Check errors above.\n");
    }

  } catch (error) {
    console.error("❌ Error during deletion:", error.message);
    console.error(error);
  }
}

// Run the deletion
console.log("⚠️  WARNING: This will delete ALL news from Sanity!\n");
console.log("Starting in 3 seconds... Press Ctrl+C to cancel\n");

setTimeout(() => {
  deleteAllNews();
}, 3000);