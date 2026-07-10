"""Vendored AdaFace IR-101 backbone (minimal, ``ir`` mode only).

This is a faithful, trimmed port of the IR-101 architecture from the official
AdaFace repository, kept here so the ONNX **export** step can reconstruct the
network and load the published checkpoint without a git dependency at export
time. It is an *export-time* module only — the benchmark runtime never imports
it (it consumes the exported ONNX via ``adaface.py``); ``torch`` is therefore
never a benchmark runtime dependency.

Only what IR-101 needs is vendored: the ``ir`` (non-SE) residual block, the
112x112 backbone, and the ``build_model('ir_101')`` entry point. The SE blocks,
GNAP/GDC heads and the other depth variants from upstream are intentionally
omitted. The layer definitions and their order are preserved verbatim so the
published ``state_dict`` loads with ``strict=True``.

Upstream source (transcribed 2026-07):
    https://github.com/mk-minchul/AdaFace  ``net.py``

------------------------------------------------------------------------------
MIT License

Copyright (c) 2022 Minchul Kim

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
------------------------------------------------------------------------------
"""

from __future__ import annotations

from collections import namedtuple

import torch
import torch.nn as nn
from torch.nn import (
    BatchNorm1d,
    BatchNorm2d,
    Conv2d,
    Dropout,
    Linear,
    MaxPool2d,
    Module,
    PReLU,
    Sequential,
)


def initialize_weights(modules):
    """Kaiming-normal init for conv/linear, ones/zeros for batchnorm."""
    for m in modules:
        if isinstance(m, nn.Conv2d):
            nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
            if m.bias is not None:
                m.bias.data.zero_()
        elif isinstance(m, nn.BatchNorm2d):
            m.weight.data.fill_(1)
            m.bias.data.zero_()
        elif isinstance(m, nn.Linear):
            nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
            if m.bias is not None:
                m.bias.data.zero_()


class Flatten(Module):
    """Flatten a tensor to ``(batch, -1)``."""

    def forward(self, input):
        return input.view(input.size(0), -1)


class BasicBlockIR(Module):
    """BasicBlock for IRNet (the ``ir`` residual unit used by IR-101)."""

    def __init__(self, in_channel, depth, stride):
        super().__init__()
        if in_channel == depth:
            self.shortcut_layer = MaxPool2d(1, stride)
        else:
            self.shortcut_layer = Sequential(
                Conv2d(in_channel, depth, (1, 1), stride, bias=False),
                BatchNorm2d(depth),
            )
        self.res_layer = Sequential(
            BatchNorm2d(in_channel),
            Conv2d(in_channel, depth, (3, 3), (1, 1), 1, bias=False),
            BatchNorm2d(depth),
            PReLU(depth),
            Conv2d(depth, depth, (3, 3), stride, 1, bias=False),
            BatchNorm2d(depth),
        )

    def forward(self, x):
        shortcut = self.shortcut_layer(x)
        res = self.res_layer(x)
        return res + shortcut


class Bottleneck(namedtuple("Block", ["in_channel", "depth", "stride"])):
    """A named tuple describing a ResNet block."""


def get_block(in_channel, depth, num_units, stride=2):
    return [Bottleneck(in_channel, depth, stride)] + [
        Bottleneck(depth, depth, 1) for _ in range(num_units - 1)
    ]


def get_blocks(num_layers):
    """Block layout. Only the IR-101 (num_layers=100) path is exercised here."""
    if num_layers == 100:
        return [
            get_block(in_channel=64, depth=64, num_units=3),
            get_block(in_channel=64, depth=128, num_units=13),
            get_block(in_channel=128, depth=256, num_units=30),
            get_block(in_channel=256, depth=512, num_units=3),
        ]
    raise ValueError(f"vendored net supports num_layers=100 only, got {num_layers}")


class Backbone(Module):
    """IR backbone (112x112 input, 512-d embedding). ``ir`` mode only."""

    def __init__(self, input_size, num_layers, mode="ir"):
        super().__init__()
        assert input_size[0] in [112, 224], "input_size should be [112,112] or [224,224]"
        assert num_layers in [100], "vendored backbone supports num_layers=100 only"
        assert mode == "ir", "vendored backbone supports 'ir' mode only"
        self.input_layer = Sequential(
            Conv2d(3, 64, (3, 3), 1, 1, bias=False), BatchNorm2d(64), PReLU(64)
        )
        blocks = get_blocks(num_layers)
        unit_module = BasicBlockIR
        output_channel = 512

        if input_size[0] == 112:
            self.output_layer = Sequential(
                BatchNorm2d(output_channel),
                Dropout(0.4),
                Flatten(),
                Linear(output_channel * 7 * 7, 512),
                BatchNorm1d(512, affine=False),
            )
        else:
            self.output_layer = Sequential(
                BatchNorm2d(output_channel),
                Dropout(0.4),
                Flatten(),
                Linear(output_channel * 14 * 14, 512),
                BatchNorm1d(512, affine=False),
            )

        modules = []
        for block in blocks:
            for bottleneck in block:
                modules.append(
                    unit_module(bottleneck.in_channel, bottleneck.depth, bottleneck.stride)
                )
        self.body = Sequential(*modules)

        initialize_weights(self.modules())

    def forward(self, x):
        x = self.input_layer(x)
        for module in self.body:
            x = module(x)
        x = self.output_layer(x)
        norm = torch.norm(x, 2, 1, True)
        output = torch.div(x, norm)
        return output, norm


def IR_101(input_size):
    """Construct an IR-101 backbone."""
    return Backbone(input_size, 100, "ir")


def build_model(model_name="ir_101"):
    """Entry point mirroring upstream ``net.build_model`` (IR-101 only here)."""
    if model_name == "ir_101":
        return IR_101(input_size=(112, 112))
    raise ValueError(f"vendored build_model supports 'ir_101' only, got {model_name!r}")
