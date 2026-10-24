require('dotenv').config();
const express = require('express');
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 1. เปิด Web Server สำหรับ Health Check บน Render (รัน 24/7)
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Machining Discord Bot with Gemini Fallback is online!');
});

app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

// 2. ตั้งค่าระบบ Gemini API แบบมี 2 Key (Fallback)
const apiKeys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2
].filter(Boolean);

async function callGeminiWithFallback(promptText) {
    if (apiKeys.length === 0) {
        throw new Error("ไม่ได้ตั้งค่า Gemini API Key ในระบบ");
    }

    let lastError = null;
    for (let i = 0; i < apiKeys.length; i++) {
        try {
            console.log(`กำลังเรียกใช้งาน Gemini API ด้วย Key ที่ ${i + 1}...`);
            const genAI = new GoogleGenerativeAI(apiKeys[i]);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            
            const result = await model.generateContent(promptText);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.warn(`⚠️ Gemini API Key ที่ ${i + 1} ล้มเหลว:`, error.message);
            lastError = error;
        }
    }
    throw new Error(`Gemini API ล้มเหลวทุก Key: ${lastError.message}`);
}

// 3. ตั้งค่าบอท Discord (แก้ไข Intents ให้ถูกต้อง ป้องกัน Error BitFieldInvalid)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const postDataMap = new Map();

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}! บอทพร้อมทำงานแล้ว`);
});

// เมื่อมีการสร้างโพสต์ใหม่ในฟอรัม
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.channel.isThread()) {
        const threadId = message.channel.id;
        
        // ให้ AI ช่วยวิเคราะห์ข้อมูลเบื้องต้นจากโพสต์งานโรงกลึง
        let aiAnalysis = "กำลังตรวจสอบข้อมูลด้วย AI...";
        try {
            const prompt = `วิเคราะห์โพสต์งานโรงกลึงนี้: "${message.content}" ประเมินสั้นๆ ว่าข้อมูลเกี่ยวกับ รายละเอียดชิ้นงาน, ขนาด, และวัสดุ ครบถ้วนหรือไม่ ถ้าขาดอะไรให้บอกสั้นๆ`;
            aiAnalysis = await callGeminiWithFallback(prompt);
        } catch (err) {
            aiAnalysis = "⚠️ AI ไม่สามารถตรวจสอบได้ในขณะนี้ (ใช้ Key สำรองแล้วยังขัดข้อง)";
        }

        postDataMap.set(threadId, {
            ownerId: message.author.id,
            title: message.channel.name,
            content: message.content,
            analysis: aiAnalysis
        });

        // ปุ่มสำหรับผู้ชม
        const viewerRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ask_details').setLabel('🔍 ขอรายละเอียดชิ้นงาน').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('ask_dims').setLabel('📏 ขอข้อมูลขนาด').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('ask_material').setLabel('🔩 ขอข้อมูลวัสดุ').setStyle(ButtonStyle.Secondary)
        );

        // ปุ่มสำหรับเจ้าของโพสต์
        const ownerRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('owner_confirm').setLabel('✅ ยืนยันข้อมูลครบถ้วน').setStyle(ButtonStyle.Success)
        );

        await message.reply({
            content: `📌 **ระบบ AI ตรวจสอบงานโรงกลึง:**\n> ${aiAnalysis}`,
            components: [viewerRow, ownerRow]
        });
    }
});

// จัดการการกดปุ่ม
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const threadId = interaction.channel.id;
    const postData = postDataMap.get(threadId);

    if (!postData) {
        return interaction.reply({ content: 'ไม่พบข้อมูลโพสต์นี้ในระบบ', ephemeral: true });
    }

    const userId = interaction.user.id;

    if (['ask_details', 'ask_dims', 'ask_material'].includes(interaction.customId)) {
        if (userId === postData.ownerId) {
            return interaction.reply({ content: 'คุณเป็นเจ้าของโพสต์ ไม่จำเป็นต้องกดเตือนตัวเองครับ', ephemeral: true });
        }

        let question = "";
        if (interaction.customId === 'ask_details') question = "รายละเอียดชิ้นงานเพิ่มเติม";
        if (interaction.customId === 'ask_dims') question = "ข้อมูลขนาด (ความกว้าง/ความยาว)";
        if (interaction.customId === 'ask_material') question = "ข้อมูลวัสดุที่ใช้ผลิต";

        return interaction.reply({
            content: `📢 **แจ้งเตือนจากผู้เยี่ยมชมถึงเจ้าของโพสต์ (<@${postData.ownerId}>):** รบกวนขอข้อมูล **${question}** เพิ่มเติมหน่อยครับ`
        });
    }

    if (interaction.customId === 'owner_confirm') {
        if (userId !== postData.ownerId) {
            return interaction.reply({ content: 'เฉพาะเจ้าของโพสต์เท่านั้นที่มีสิทธิ์กดยืนยันข้อมูลนี้ครับ', ephemeral: true });
        }

        const currentDate = new Date().toISOString().split('T')[0];
        const cleanTitle = postData.title.replace(/^\[.*?\]\s*/, '');
        const newThreadName = `${currentDate} - ${cleanTitle}`;
        
        try {
            await interaction.channel.setName(newThreadName);
        } catch (error) {
            console.error('ไม่สามารถเปลี่ยนชื่อ Thread ได้:', error);
        }

        const summaryEmbed = new EmbedBuilder()
            .setTitle('📋 สรุปข้อมูลงานโรงกลึง (ข้อมูลครบถ้วน)')
            .setDescription(`**ชื่องาน:** ${cleanTitle}\n**วันที่อัปเดต:** ${currentDate}\n\n**รายละเอียดเบื้องต้น:**\n${postData.content}`)
            .setColor(0x00FF00)
            .setTimestamp();

        await interaction.channel.send({ embeds: [summaryEmbed] });
        
        return interaction.update({ 
            content: '✅ **ยืนยันข้อมูลสำเร็จ:** บอทได้ทำการอัปเดตชื่อโพสต์และสรุปข้อมูลเรียบร้อยแล้วครับ!', 
            components: [] 
        });
    }
});

// เริ่มต้นทำงานบอทโดยดึง Token จาก Environment Variable
client.login(process.env.DISCORD_TOKEN);