  function Icon({ children, size = 16, color = "currentColor", fill = "none", strokeWidth = 2, style, ...rest }) {
    return /* @__PURE__ */ React.createElement(
      "svg",
      {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill,
        stroke: color,
        strokeWidth,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        style,
        ...rest
      },
      children
    );
  }
  function Check(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("polyline", { points: "20 6 9 17 4 12" }));
  }
  function Plus(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "5", x2: "12", y2: "19" }), /* @__PURE__ */ React.createElement("line", { x1: "5", y1: "12", x2: "19", y2: "12" }));
  }
  function X(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("line", { x1: "18", y1: "6", x2: "6", y2: "18" }), /* @__PURE__ */ React.createElement("line", { x1: "6", y1: "6", x2: "18", y2: "18" }));
  }
  function ChevronDown(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("polyline", { points: "6 9 12 15 18 9" }));
  }
  function ChevronUp(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("polyline", { points: "18 15 12 9 6 15" }));
  }
  function Star(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("polygon", { points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" }));
  }
  function Sun(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "4" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "2", x2: "12", y2: "4" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "20", x2: "12", y2: "22" }), /* @__PURE__ */ React.createElement("line", { x1: "4.93", y1: "4.93", x2: "6.34", y2: "6.34" }), /* @__PURE__ */ React.createElement("line", { x1: "17.66", y1: "17.66", x2: "19.07", y2: "19.07" }), /* @__PURE__ */ React.createElement("line", { x1: "2", y1: "12", x2: "4", y2: "12" }), /* @__PURE__ */ React.createElement("line", { x1: "20", y1: "12", x2: "22", y2: "12" }), /* @__PURE__ */ React.createElement("line", { x1: "4.93", y1: "19.07", x2: "6.34", y2: "17.66" }), /* @__PURE__ */ React.createElement("line", { x1: "17.66", y1: "6.34", x2: "19.07", y2: "4.93" }));
  }
  function Moon(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("path", { d: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" }));
  }
  function Pencil(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("path", { d: "M12 20h9" }), /* @__PURE__ */ React.createElement("path", { d: "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" }));
  }
  function Users(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("path", { d: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" }), /* @__PURE__ */ React.createElement("circle", { cx: "9", cy: "7", r: "4" }), /* @__PURE__ */ React.createElement("path", { d: "M23 21v-2a4 4 0 0 0-3-3.87" }), /* @__PURE__ */ React.createElement("path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }));
  }
  function Trash2(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("polyline", { points: "3 6 5 6 21 6" }), /* @__PURE__ */ React.createElement("path", { d: "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" }), /* @__PURE__ */ React.createElement("path", { d: "M10 11v6" }), /* @__PURE__ */ React.createElement("path", { d: "M14 11v6" }), /* @__PURE__ */ React.createElement("path", { d: "M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" }));
  }
  function Gift(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("polyline", { points: "20 12 20 22 4 22 4 12" }), /* @__PURE__ */ React.createElement("rect", { x: "2", y: "7", width: "20", height: "5" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "22", x2: "12", y2: "7" }), /* @__PURE__ */ React.createElement("path", { d: "M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" }), /* @__PURE__ */ React.createElement("path", { d: "M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" }));
  }
  function Coins(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("circle", { cx: "8", cy: "8", r: "6" }), /* @__PURE__ */ React.createElement("path", { d: "M18.09 10.37A6 6 0 1 1 10.34 18" }), /* @__PURE__ */ React.createElement("path", { d: "M7 6h1v4" }), /* @__PURE__ */ React.createElement("path", { d: "m16.71 13.88.7.71-2.82 2.82" }));
  }
  function PartyPopper(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("path", { d: "M5.8 11.3 2 22l10.7-3.79" }), /* @__PURE__ */ React.createElement("path", { d: "M4 3h.01" }), /* @__PURE__ */ React.createElement("path", { d: "M22 8h.01" }), /* @__PURE__ */ React.createElement("path", { d: "M15 2h.01" }), /* @__PURE__ */ React.createElement("path", { d: "M22 20h.01" }), /* @__PURE__ */ React.createElement("path", { d: "m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10" }), /* @__PURE__ */ React.createElement("path", { d: "m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11-.11.7-.72 1.22-1.43 1.22H17" }), /* @__PURE__ */ React.createElement("path", { d: "m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.91 9 5.52 9 6.23V7" }));
  }
  function Flame(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("path", { d: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" }));
  }
  function Lock(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "11", width: "18", height: "11", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }));
  }
  function Unlock(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "11", width: "18", height: "11", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M7 11V7a5 5 0 0 1 9.9-1" }));
  }
  function BookOpen(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("path", { d: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" }), /* @__PURE__ */ React.createElement("path", { d: "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" }));
  }
  function Sparkles(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("path", { d: "M12 3v4M12 17v4M3 12h4M17 12h4" }), /* @__PURE__ */ React.createElement("path", { d: "M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" }));
  }
  function Copy(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("rect", { x: "9", y: "9", width: "13", height: "13", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" }));
  }
  function Cloud(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("path", { d: "M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.7A4 4 0 0 0 6.5 19h11z" }));
  }
  function CloudRain(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("path", { d: "M16 13a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.7A4 4 0 0 0 5 13h11z" }), /* @__PURE__ */ React.createElement("path", { d: "M8 16l-1 3M13 16l-1 3M18 16l-1 3" }));
  }
  function CloudSnow(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("path", { d: "M16 13a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.7A4 4 0 0 0 5 13h11z" }), /* @__PURE__ */ React.createElement("path", { d: "M8 16v.01M8 20v.01M12 18v.01M12 22v.01M16 16v.01M16 20v.01" }));
  }
  function CloudLightning(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("path", { d: "M16 12a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.7A4 4 0 0 0 5 12h4" }), /* @__PURE__ */ React.createElement("path", { d: "M13 12l-3 5h4l-3 5" }));
  }
  function CloudSun(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("path", { d: "M12 3v1M18.4 5.6l-.7.7M20 12h1M6.3 6.3l-.7-.7" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "10", r: "3" }), /* @__PURE__ */ React.createElement("path", { d: "M17 18a4 4 0 0 0-8 0h-1a3 3 0 0 0 0 6h9.5a3.5 3.5 0 0 0 .5-6.96A4 4 0 0 0 17 18z" }));
  }
  function CloudMoon(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("path", { d: "M13.5 4.5a5 5 0 1 0 4.5 7.9" }), /* @__PURE__ */ React.createElement("path", { d: "M17 18a4 4 0 0 0-8 0h-1a3 3 0 0 0 0 6h9.5a3.5 3.5 0 0 0 .5-6.96A4 4 0 0 0 17 18z" }));
  }
  function GripVertical(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("circle", { cx: "9", cy: "5", r: "1" }), /* @__PURE__ */ React.createElement("circle", { cx: "9", cy: "12", r: "1" }), /* @__PURE__ */ React.createElement("circle", { cx: "9", cy: "19", r: "1" }), /* @__PURE__ */ React.createElement("circle", { cx: "15", cy: "5", r: "1" }), /* @__PURE__ */ React.createElement("circle", { cx: "15", cy: "12", r: "1" }), /* @__PURE__ */ React.createElement("circle", { cx: "15", cy: "19", r: "1" }));
  }
  function Clock(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "9" }), /* @__PURE__ */ React.createElement("path", { d: "M12 7v5l3 3" }));
  }
  function HelpCircle(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "9" }), /* @__PURE__ */ React.createElement("path", { d: "M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2-2.4 3.4" }), /* @__PURE__ */ React.createElement("path", { d: "M12 17.2v.1" }));
  }
  function Smartphone(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("rect", { x: "7", y: "2", width: "10", height: "20", rx: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M11 18h2" }));
  }
  function Settings(props) {
    return /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("path", { d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "3" }));
  }
