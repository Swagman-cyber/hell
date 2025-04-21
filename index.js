require('dotenv').config(); // Load environment variables from a .env file
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const db = require('better-sqlite3')('verification.db'); // Example for SQLite DB

// Initialize the bot client with the appropriate intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Log the bot in using the token from environment variables
client.login(process.env.BOT_TOKEN);

// Map to store pending verifications
const pendingVerifications = new Map();

// Function to generate a unique verification code
function generateCode() {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
}

// Command listener for messages
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  // !verify command
  if (command === '!verify') {
    const robloxUsername = args[1];
    if (!robloxUsername) {
      return message.reply('❗ Please provide your Roblox username. Usage: !verify <username>');
    }

    try {
      // Fetch Roblox user info using the Roblox API
      const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
        usernames: [robloxUsername],
        excludeBannedUsers: true
      });

      const userData = res.data.data[0];
      if (!userData) return message.reply('❌ Roblox user not found.');

      const robloxId = userData.id;
      const robloxProfileUrl = `https://www.roblox.com/users/${robloxId}/profile`;

      // Fetch profile image URL
      const profileImageUrl = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxId}&size=420x420&format=Png&isCircular=false`;

      // Generate a unique verification code
      const code = generateCode();

      // Store the verification info in the pending map
      pendingVerifications.set(message.author.id, { robloxId, code });

      // Create an embed to send to the user
      const embed = new EmbedBuilder()
        .setTitle('Roblox Verification')
        .setDescription(`✅ **Paste this code into your Roblox About Me:**\n\`${code}\`\nThen type \`!confirm\` when you're done.`)
        .setColor('Green')
        .setThumbnail(profileImageUrl)
        .setURL(robloxProfileUrl);

      // Send the verification instructions to the user
      return message.reply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      return message.reply('❌ Failed to fetch Roblox user info.');
    }
  }

  // !confirm command (for code verification)
  if (command === '!confirm') {
    const entry = pendingVerifications.get(message.author.id);
    if (!entry) return message.reply('❗ You need to use !verify <username> first.');

    try {
      // Fetch Roblox profile description to check the code
      const profile = await axios.get(`https://users.roblox.com/v1/users/${entry.robloxId}`);
      const description = profile.data.description || '';

      // Check if the code is present in the Roblox description
      if (description.includes(entry.code)) {
        // Check if the code has already been used
        const row = db.prepare('SELECT * FROM usedCodes WHERE code = ? AND robloxId = ?').get(entry.code, entry.robloxId);
        if (row) {
          return message.reply('❌ This code has already been used or is invalid.');
        }

        // Store the used code in the database to prevent reuse
        db.prepare('INSERT INTO usedCodes (code, robloxId) VALUES (?, ?)').run(entry.code, entry.robloxId);

        // Assign a role to the user (e.g., "Verified")
        const guild = message.guild;
        const role = guild.roles.cache.find(r => r.name.toLowerCase() === 'verified');
        if (!role) {
          return message.reply('❌ The "Verified" role does not exist in the server. Please create it.');
        }

        const member = guild.members.cache.get(message.author.id);
        if (member) {
          await member.roles.add(role);
          return message.reply('✅ Verification successful! You have been assigned the Verified role.');
        } else {
          return message.reply('❌ Could not find you in the server.');
        }
      } else {
        return message.reply('❌ The verification code does not match. Please make sure you entered the code correctly in your Roblox profile.');
      }
    } catch (error) {
      console.error(error);
      return message.reply('❌ Failed to verify user on Roblox.');
    }
  }
});

// Error handling for uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
