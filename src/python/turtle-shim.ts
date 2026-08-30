/**
 * A `turtle` module for Pyodide.
 *
 * CPython's turtle draws through tkinter, which Pyodide does not ship, so
 * `import turtle` fails outright in the browser. This is a stand-in with the
 * same names and the same coordinate system -- origin in the middle, y upwards,
 * angles counter-clockwise from east -- that computes the geometry in Python and
 * posts plain line segments out to a canvas.
 *
 * Only the subset the blocks need is implemented. It is deliberately not a full
 * turtle: no screens, no multiple turtles, no event loop.
 */
export const TURTLE_MODULE = 'turtle';

/** Name of the JS module the worker registers for the shim to draw through. */
export const CANVAS_MODULE = '_snappy_canvas';

export const TURTLE_SHIM = `
import json as _json
import math as _math
import sys as _sys
import types as _types

from ${CANVAS_MODULE} import emit as _send


def _emit(op, *args):
    _send(op, _json.dumps(list(args)))


class _Pen:
    def __init__(self):
        self.x = 0.0
        self.y = 0.0
        self.angle = 0.0
        self.down = True
        self.color = "#1a1a1a"
        self.size = 2
        self.visible = True
        self._show()

    def _show(self):
        _emit("turtle", self.x, self.y, self.angle, self.visible)

    def _move_to(self, nx, ny):
        if self.down:
            _emit("line", self.x, self.y, nx, ny, self.color, self.size)
        self.x = nx
        self.y = ny
        self._show()

    def forward(self, distance):
        radians = _math.radians(self.angle)
        self._move_to(
            self.x + distance * _math.cos(radians),
            self.y + distance * _math.sin(radians),
        )

    def backward(self, distance):
        self.forward(-distance)

    def left(self, degrees):
        self.angle = (self.angle + degrees) % 360.0
        self._show()

    def right(self, degrees):
        self.left(-degrees)

    def goto(self, x, y=None):
        if y is None:
            x, y = x
        self._move_to(float(x), float(y))

    def setx(self, x):
        self._move_to(float(x), self.y)

    def sety(self, y):
        self._move_to(self.x, float(y))

    def setheading(self, degrees):
        self.angle = float(degrees) % 360.0
        self._show()

    def home(self):
        self._move_to(0.0, 0.0)
        self.setheading(0)

    def penup(self):
        self.down = False

    def pendown(self):
        self.down = True

    def pencolor(self, color=None):
        if color is None:
            return self.color
        self.color = str(color)
        return None

    def pensize(self, size=None):
        if size is None:
            return self.size
        self.size = max(1, int(size))
        return None

    def dot(self, size=None, color=None):
        size = self.size * 2 if size is None else int(size)
        _emit("dot", self.x, self.y, max(1, size), str(color or self.color))

    def circle(self, radius, extent=360.0):
        """Traced as a polygon, the way the real turtle does it."""
        radius = float(radius)
        extent = float(extent)
        if radius == 0 or extent == 0:
            return
        steps = max(8, int(abs(extent) / 5.0))
        direction = 1.0 if radius >= 0 else -1.0
        step_angle = (extent / steps) * direction
        step_length = 2.0 * abs(radius) * _math.sin(_math.radians(abs(step_angle) / 2.0))
        for _ in range(steps):
            self.left(step_angle / 2.0)
            self.forward(step_length)
            self.left(step_angle / 2.0)

    def clear(self):
        _emit("clear")
        self._show()

    def reset(self):
        self.__init__()

    def hideturtle(self):
        self.visible = False
        self._show()

    def showturtle(self):
        self.visible = True
        self._show()

    def speed(self, value=None):
        # Drawing is immediate here, so speed is accepted and ignored rather
        # than raising on a program copied from a tutorial.
        return 0 if value is None else None


_pen = None


def _turtle():
    global _pen
    if _pen is None:
        _pen = _Pen()
    return _pen


_module = _types.ModuleType("turtle")


def _expose(name, call):
    setattr(_module, name, call)


_expose("forward", lambda d: _turtle().forward(d))
_expose("backward", lambda d: _turtle().backward(d))
_expose("left", lambda a: _turtle().left(a))
_expose("right", lambda a: _turtle().right(a))
_expose("goto", lambda x, y=None: _turtle().goto(x, y))
_expose("setx", lambda x: _turtle().setx(x))
_expose("sety", lambda y: _turtle().sety(y))
_expose("setheading", lambda a: _turtle().setheading(a))
_expose("home", lambda: _turtle().home())
_expose("penup", lambda: _turtle().penup())
_expose("pendown", lambda: _turtle().pendown())
_expose("pencolor", lambda c=None: _turtle().pencolor(c))
_expose("pensize", lambda s=None: _turtle().pensize(s))
_expose("dot", lambda size=None, color=None: _turtle().dot(size, color))
_expose("circle", lambda r, extent=360.0: _turtle().circle(r, extent))
_expose("clear", lambda: _turtle().clear())
_expose("reset", lambda: _turtle().reset())
_expose("hideturtle", lambda: _turtle().hideturtle())
_expose("showturtle", lambda: _turtle().showturtle())
_expose("speed", lambda v=None: _turtle().speed(v))
_expose("xcor", lambda: _turtle().x)
_expose("ycor", lambda: _turtle().y)
_expose("heading", lambda: _turtle().angle)
_expose("position", lambda: (_turtle().x, _turtle().y))

# The short aliases people actually type.
for _short, _long in (
    ("fd", "forward"), ("bk", "backward"), ("back", "backward"),
    ("lt", "left"), ("rt", "right"), ("seth", "setheading"),
    ("pu", "penup"), ("up", "penup"), ("pd", "pendown"), ("down", "pendown"),
    ("color", "pencolor"), ("width", "pensize"), ("ht", "hideturtle"),
    ("st", "showturtle"), ("setpos", "goto"), ("setposition", "goto"),
    ("pos", "position"),
):
    setattr(_module, _short, getattr(_module, _long))

# A finished drawing needs no event loop here, but tutorials always call these.
_expose("done", lambda: None)
_expose("mainloop", lambda: None)
_expose("exitonclick", lambda: None)

_sys.modules["turtle"] = _module
`;
