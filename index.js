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

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Machining Owner Bot is online!');
});

app.listen(PORT, () => {
    console.log(`Owner Server listening on port ${PORT}`);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callGeminiWithFallback(promptText) {
    const apiKeys = [
        process.env.GEMINI_API_KEY_1,
        process.env.GEMINI_API_KEY_2
    ].filter(Boolean);

    if (apiKeys.length === 0) {
        throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY_1 หรือ GEMINI_API_KEY_2 ใน Environment Variables ของ Render");
    }

    let lastError = null;
    for (let i = 0; i < apiKeys.length; i++) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`กำลังเรียกใช้งาน Gemini API ด้วย Key ที่ ${i + 1} (พยายามครั้งที่ ${attempt})...`);
                const genAI = new GoogleGenerativeAI(apiKeys[i]);
                const model = genAI.getGenerativeModel({ model: "gemini-3.8-flash" });
                const result = await model.generateContent(promptText);
                const response = await result.response;
                return response.text();
            } catch (error) {
                console.warn(`⚠️ Key ที่ ${i + 1} (ครั้งที่ ${attempt}) ล้มเหลว:`, error.message);
                lastError = error;
                // ถ้าเจอ 503 หรือ High Demand ให้รอ 2 วินาทีก่อนรีไทรอัตโนมัติ
                if (error.message.includes('503') || error.message.includes('overloaded')) {
                    await sleep(2000);
                } else {
                    break;
                }
            }
        }
    }
    throw new Error(`Gemini API ล้มเหลวทุก Key: ${lastError ? lastError.message : 'Unknown error'}`);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const postDataMap = new Map();

client.once('ready', () => {
    console.log(`Owner Bot Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.channel.isThread()) {
        const threadId = message.channel.id;
        
        let postData = postDataMap.get(threadId);
        if (!postData) {
            postData = {
                ownerId: message.author.id,
                contents: [message.content],
                botMessage: null
            };
            postDataMap.set(threadId, postData);

            const confirmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_summary')
                    .setLabel('✅ ยืนยันข้อมูลและสรุปงาน')
                    .setStyle(ButtonStyle.Success)
            );

            postData.botMessage = await message.reply({
                content: `📌 **ข้อมูลครบหรือยัง?** กดยืนยันด้านล่างได้เลย (หากมีเพิ่มพิมพ์ส่งมาได้ครับ)`,
                components: [confirmRow]
            });
        } else {
            postData.contents.push(message.content);
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'confirm_summary') {
        const threadId = interaction.channel.id;
        const postData = postDataMap.get(threadId);

        if (!postData) {
            return interaction.reply({ content: '❌ ไม่พบข้อมูลโพสต์นี้ในระบบ กรุณาลองใหม่อีกครั้ง', ephemeral: true });
        }

        if (interaction.user.id !== postData.ownerId) {
            return interaction.reply({ content: '❌ เฉพาะเจ้าของโพสต์เท่านั้นที่มีสิทธิ์กดยืนยันครับ', ephemeral: true });
        }

        await interaction.deferUpdate();

        // แจ้งสถานะกำลังประมวลผลทันทีที่กดปุ่ม
        if (postData.botMessage) {
            await postData.botMessage.edit({
                content: `⏳ **กำลังประมวลผล...** (ระบบกำลังเรียกใช้งาน AI และลองใหม่อัตโนมัติหากเซิร์ฟเวอร์หนหน่วง)`,
                components: []
            }).catch(() => {});
        }

        const fullContent = postData.contents.join('\n');

        try {
            const prompt = `วิเคราะห์โพสต์งานโรงกลึงนี้: "${fullContent}"
วิเคราะห์และดึงข้อมูลตามเงื่อนไขนี้อย่างเคร่งครัด:
1. ชื่อบริษัทลูกค้า: มักเป็นตัวย่อ/ชื่อย่อ (เช่น CGS)
2. ชื่อลูกค้า: มักจะมีคำว่า "k.", "คุณ", หรือชื่อบุคคลต่อท้ายชื่อบริษัท (เช่น k.สาคร, คุณสาคร, ช่างสาคร) ห้ามสับสนกับชื่อบริษัท
3. ประเภทงาน: ระบุว่าเป็น "ทำใหม่" หรือ "แก้ไข"
4. รายละเอียดงาน: หากมีคำว่า "ตามตัวอย่าง", "ตาม ตย.", "ตามรูป", "ตามไฟล์แนบ" ให้สรุปว่าอ้างอิงรายละเอียดตามรูปภาพตัวอย่างที่แนบมาด้วย

จัดรูปแบบการตอบดังนี้:
- ชื่อบริษัทลูกค้า: [ระบุชื่อบริษัท/ชื่อย่อ]
- ชื่อลูกค้า: [ระบุชื่อลูกค้า]
- ประเภทงาน: [ทำใหม่ หรือ แก้ไข]
- รายละเอียดงาน: [ระบุรายละเอียดงาน เช่น ตามรูปภาพตัวอย่าง/ข้อความ]`;

            const aiResponse = await callGeminiWithFallback(prompt);

            const employeeName = interaction.member ? interaction.member.displayName : interaction.user.username;

            let companyName = "ไม่ระบุชื่อบริษัท";
            let customerName = "ไม่ระบุชื่อลูกค้า";
            let jobType = "ทำใหม่";
            let jobDetails = fullContent;

            const companyMatch = aiResponse.match(/- ชื่อบริษัทลูกค้า:\s*(.*)/);
            const customerMatch = aiResponse.match(/- ชื่อลูกค้า:\s*(.*)/);
            const typeMatch = aiResponse.match(/- ประเภทงาน:\s*(.*)/);
            const detailsMatch = aiResponse.match(/- รายละเอียดงาน:\s*([\s\S]*)/);

            if (companyMatch) companyName = companyMatch[1].trim();
            if (customerMatch) customerName = customerMatch[1].trim();
            if (typeMatch) jobType = typeMatch[1].trim();
            if (detailsMatch) jobDetails = detailsMatch[1].trim();

            const currentDate = new Date().toISOString().split('T')[0];
            const newThreadName = `${currentDate} - ${companyName}`;

            try {
                await interaction.channel.setName(newThreadName);
            } catch (error) {
                console.error('ไม่สามารถเปลี่ยนชื่อ Thread ได้:', error);
            }

            const summaryEmbed = new EmbedBuilder()
                .setTitle('📋 สรุปข้อมูลงาน')
                .setColor(0x00FF00)
                .addFields(
                    { name: '🏢 ชื่อบริษัทลูกค้า', value: companyName, inline: false },
                    { name: '👤 ชื่อลูกค้า', value: customerName, inline: false },
                    { name: '👨‍💻 ชื่อพนักงาน (ผู้บันทึก)', value: employeeName, inline: false },
                    { name: '📌 ประเภทงาน', value: jobType, inline: false },
                    { name: '⚙️ รายละเอียดงาน', value: jobDetails, inline: false }
                )
                .setTimestamp();

            await interaction.channel.send({ embeds: [summaryEmbed] });

            if (postData.botMessage) {
                await postData.botMessage.edit({
                    content: `✅ **ยืนยันและสรุปข้อมูลเรียบร้อยแล้วโดยคุณ ${employeeName}**`,
                    components: []
                }).catch(() => {});
            }

        } catch (err) {
            console.error("Summary Error:", err);
            if (postData.botMessage) {
                await postData.botMessage.edit({
                    content: `❌ เกิดข้อผิดพลาด: ${err.message}`,
                    components: []
                }).catch(() => {});
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);