#!/data/data/com.termux/files/usr/bin/bash
# ═══════════════════════════════════════
#  🤖 Claw Office AI — سكريبت التحديث التلقائي
#  الاستخدام: bash update.sh
# ═══════════════════════════════════════

echo "╔════════════════════════════════════════════╗"
echo "║     🔄 تحديث Claw Office AI من GitHub      ║"
echo "╚════════════════════════════════════════════╝"

cd "$(dirname "$0")" || exit 1

# إيقاف الخادم القديم إن كان يعمل
pkill -f "node server.js" 2>/dev/null && echo "⏹ تم إيقاف الخادم القديم"

# حفظ البيانات والإعدادات المحلية قبل التحديث
if [ -f data.json ]; then
  cp data.json data.json.bak
  echo "💾 تم حفظ نسخة احتياطية من بياناتك (data.json.bak)"
fi

# سحب آخر التحديثات
echo "⬇ جارٍ سحب التحديثات من GitHub..."
git pull origin main

# استرجاع بياناتك (لا تُمسح أبداً أثناء التحديث)
if [ -f data.json.bak ]; then
  cp data.json.bak data.json
  echo "✅ تم استرجاع بياناتك وإعداداتك"
fi

# تشغيل الخادم
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║        🚀 تشغيل الخادم الآن...             ║"
echo "╚════════════════════════════════════════════╝"
node server.js
