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

// 3. ตั้งค่าบอท Discord
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
        
        // เก็บข้อมูลโพสต์ตั้งต้น
        postDataMap.set(threadId, {
            ownerId: message.author.id,
            content: message.content
        });

        // แสดงปุ่มเดียวสำหรับสั่งให้ AI ตรวจสอบและสรุปผล
        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('check_and_summarize')
                .setLabel('📋 ตรวจสอบและสรุปข้อมูลงาน')
                .setStyle(ButtonStyle.Primary)
        );

        await message.reply({
            content: `📌 **ระบบจัดการโพสต์งานโรงกลึง:** กดปุ่มด้านล่างเพื่อให้ AI ตรวจสอบความครบถ้วนและสรุปข้อมูลครับ`,
            components: [actionRow]
        });
    }
});

// จัดการการกดปุ่ม
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'check_and_summarize') {
        const threadId = interaction.channel.id;
        const postData = postDataMap.get(threadId);

        if (!postData) {
            return interaction.reply({ content: 'ไม่พบข้อมูลโพสต์นี้ในระบบ', ephemeral: true });
        }

        await interaction.deferReply();

        try {
            // ใช้ AI วิเคราะห์ข้อมูลและสกัดหัวข้อตามต้องการ
            const prompt = `วิเคราะห์โพสต์งานโรงกลึงนี้: "${postData.content}"
ตรวจสอบว่ามีข้อมูลครบถ้วนหรือไม่ (ต้องมี: ชื่อบริษัทลูกค้า, ชื่อลูกค้า, และรายละเอียดงาน เช่น ขนาด วัสดุ จำนวน)
หากข้อมูลไม่ครบ ให้ขึ้นต้นด้วยคำว่า "INCOMPLETE:" ตามด้วยสิ่งที่ขาดหายไปสั้นๆ
หากข้อมูลครบ ให้ขึ้นต้นด้วยคำว่า "COMPLETE:" ตามด้วยข้อมูลในรูปแบบนี้:
- ชื่อบริษัทลูกค้า: [ระบุชื่อบริษัทลูกค้า]
- ชื่อลูกค้า: [ระบุชื่อลูกค้า]
- รายละเอียดงาน: [ระบุรายละเอียด ขนาด วัสดุ จำนวน]`;

            const aiResponse = await callGeminiWithFallback(prompt);

            if (aiResponse.includes('INCOMPLETE:')) {
                const missingInfo = aiResponse.replace('INCOMPLETE:', '').trim();
                return interaction.editReply({
                    content: `⚠️ **ข้อมูลยังไม่ครบถ้วนครับ:**\n> ${missingInfo}\n\nกรุณาเพิ่มข้อมูลให้เรียบร้อยแล้วกดปุ่มตรวจสอบใหม่อีกครั้ง`
                });
            }

            // ถ้าข้อมูลครบ ดึงชื่อพนักงานจากชื่อ Discord ของผู้กดปุ่ม
            const employeeName = interaction.member ? interaction.member.displayName : interaction.user.username;

            // สกัดข้อมูลจาก AI Response
            let companyName = "ไม่ระบุชื่อบริษัท";
            let customerName = "ไม่ระบุชื่อลูกค้า";
            let jobDetails = postData.content;

            const companyMatch = aiResponse.match(/- ชื่อบริษัทลูกค้า:\s*(.*)/);
            const customerMatch = aiResponse.match(/- ชื่อลูกค้า:\s*(.*)/);
            const detailsMatch = aiResponse.match(/- รายละเอียดงาน:\s*([\s\S]*)/);

            if (companyMatch) companyName = companyMatch[1].trim();
            if (customerMatch) customerName = customerMatch[1].trim();
            if (detailsMatch) jobDetails = detailsMatch[1].trim();

            // เปลี่ยนชื่อโพสต์เป็น วันที่ + ชื่อบริษัทลูกค้า
            const currentDate = new Date().toISOString().split('T')[0];
            const newThreadName = `${currentDate} - ${companyName}`;

            try {
                await interaction.channel.setName(newThreadName);
            } catch (error) {
                console.error('ไม่สามารถเปลี่ยนชื่อ Thread ได้:', error);
            }

            // สร้าง Embed สรุป 4 หัวข้อ
            const summaryEmbed = new EmbedBuilder()
                .setTitle('📋 สรุปข้อมูลงานโรงกลึง (ข้อมูลครบถ้วน)')
                .setColor(0x00FF00)
                .addFields(
                    { name: '🏢 ชื่อบริษัทลูกค้า', value: companyName, inline: false },
                    { name: '👤 ชื่อลูกค้า', value: customerName, inline: false },
                    { name: '👨‍💻 ชื่อพนักงาน (ผู้บันทึก)', value: employeeName, inline: false },
                    { name: '⚙️ รายละเอียดงาน', value: jobDetails, inline: false }
                )
                .setTimestamp();

            await interaction.channel.send({ embeds: [summaryEmbed] });

            // ลบปุ่มออกหลังจากการยืนยันสำเร็จ
            await interaction.message.edit({
                content: `✅ **ตรวจสอบและสรุปข้อมูลเรียบร้อยแล้วโดยคุณ ${employeeName}**`,
                components: []
            });

            await interaction.editReply({ content: '✅ ดำเนินการเสร็จสิ้น!' });

        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: '❌ เกิดข้อผิดพลาดในการประมวลผลของ AI กรุณาลองใหม่อีกครั้ง' });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);