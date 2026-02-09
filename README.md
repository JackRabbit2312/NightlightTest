
<div align="center">

  # 🌙 Nightlight Dashboard
  ### The Ultimate Family Command Center for Home Assistant

  [![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=for-the-badge)](https://github.com/hacs/integration)
  [![version](https://img.shields.io/badge/version-1.0.0-blue.svg?style=for-the-badge)]()
  [![maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg?style=for-the-badge)]()

  <p align="center">
    <b>Turn that dusty iPad into a beautiful, futuristic family hub.</b><br>
    Zero build steps. Zero complex config. 100% Native.
  </p>

  ---
</div>

## 🧐 What is it?

**Nightlight** is a standalone, single-file dashboard card designed specifically for **Wall-Mounted Tablets** and **Kitchen Kiosks**. 

Unlike standard Lovelace dashboards that require hours of fiddling with grid layouts and CSS, Nightlight drops a complete **Operating System for your Family** right onto your dashboard.

### ✨ The "It Just Works" Promise
*   **⚡️ Instant Load:** No complex React builds or webpacks. It's just modern Javascript.
*   **🎨 Auto-Theming:** Respects your Home Assistant Dark/Light mode instantly.
*   **📱 Responsive:** Flows perfectly from an iPad Mini to a 24" Touch Monitor.

---

## 💎 Features

### 📅 1. The Family Calendar
A beautiful, touch-first monthly view.
*   **Big Targets:** Designed for fat fingers.
*   **Visual Dots:** Color-coded event indicators.
*   **Smooth Navigation:** Butter-smooth month transitions.

### 🍽️ 2. Meal Planner
*Stop asking "What's for dinner?"*
*   **Weekly View:** See the whole week at a glance.
*   **Quick Edit:** Tap and type. Simple text entry for fast planning.
*   **Card Layout:** Elegant card-based design for Monday through Sunday.

### 📝 3. Sticky Notes
The digital refrigerator door.
*   **Post-it Style:** Playful, tilted sticky notes.
*   **Color Coded:** Visual separation for different contexts.
*   **Instant Add/Remove:** Jot down a wifi password or a reminder in seconds.

### ✅ 4. Chore Tracker (Gamified)
Make chores less of a chore.
*   **Profile Pictures:** See who needs to do what.
*   **Satisfying Toggles:** Big, chunky checkboxes.
*   **Morning/Evening Context:** Filter tasks by time of day.

---

## 🚀 Installation

You can get Nightlight running in less than 60 seconds.

### Option A: HACS (The Easy Way)
1.  Go to **HACS** > **Frontend**.
2.  Click the **3 dots** (top right) > **Custom Repositories**.
3.  Paste the URL of this repository.
4.  Select Category: **Dashboard**.
5.  Click **Add**, then find **Nightlight Dashboard** in the list and install.
6.  **Reload** your browser.

### Option B: Manual (The Hacker Way)
1.  Download `nightlight-dashboard.js` from this repo.
2.  Upload it to your Home Assistant `config/www/` folder.
3.  Go to **Settings** > **Dashboards** > **Resources**.
4.  Add Resource: `/local/nightlight-dashboard.js` (Type: JavaScript Module).

---

## ⚙️ Configuration

Nightlight is a **Card**, so you can add it to any dashboard view. For the best experience, use "Panel Mode" (one card per screen).

### 1. Create a New Dashboard
Go to Settings > Dashboards > Add Dashboard > **"Kitchen Kiosk"**.

### 2. Add the Card
Select "Manual Card" and paste this:

```yaml
type: custom:nightlight-dashboard
theme: auto  # options: light, dark, auto
```

### 3. That's it!
You will immediately see the dashboard populated with **Demo Data**. 

> **Note:** Currently, Nightlight runs in "Standalone Mode" with internal state management. Future updates will allow binding the Calendar and Chores directly to Home Assistant entities via the config.

---

## 🖼️ Gallery

| Dark Mode | Light Mode |
| :---: | :---: |
| ⚫️ **OLED Ready** | ⚪️ **Clean & Crisp** |
| Perfect for night time. | High contrast for bright kitchens. |

---

## 🛠️ Advanced Configuration

Currently, the card accepts the following simple configuration:

```yaml
type: custom:nightlight-dashboard
# Force a specific theme (defaults to system preference)
theme: dark 
```

---

<div align="center">
  <br>
  <b>Made with ❤️ for Home Assistant</b>
  <br>
  <sub><i>Not affiliated with Nabu Casa.</i></sub>
</div>
